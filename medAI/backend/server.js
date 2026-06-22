import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Helper to clean JSON string from LLM response
function cleanJSONResponse(rawText) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return JSON.parse(cleaned.trim());
}

// Fallback Local Medical Parser when no API key is available
function fallbackLocalAnalysis(text) {
  const normalizedText = text.toLowerCase();
  
  // Emergency indicators
  let isEmergency = false;
  let emergencyReason = null;
  
  if (normalizedText.includes('troponin') && (normalizedText.match(/troponin.*(0\.[4-9]|[1-9]\d*)/i) || normalizedText.includes('critical') || normalizedText.includes('high') || normalizedText.includes('5.4'))) {
    isEmergency = true;
    emergencyReason = "Critically high Troponin level detected. This is a red-flag emergency indicator that may suggest active heart muscle damage (such as a heart attack). Seek immediate medical attention.";
  } else if (normalizedText.includes('stroke') || normalizedText.includes('facial droop') || normalizedText.includes('arm weakness') || normalizedText.includes('slurred speech') || normalizedText.includes('hemiparesis')) {
    isEmergency = true;
    emergencyReason = "Symptoms or notes indicating a potential stroke (facial asymmetry, weakness, speech difficulties). This is a critical medical emergency. Seek emergency care immediately.";
  } else if (normalizedText.includes('sepsis') || normalizedText.includes('septic shock') || (normalizedText.includes('lactate') && normalizedText.includes('critical'))) {
    isEmergency = true;
    emergencyReason = "Sepsis or critical blood lactate levels mentioned. Sepsis is a life-threatening response to infection. Urgent medical evaluation is required.";
  } else if (normalizedText.includes('respiratory failure') || normalizedText.includes('severe hypoxia') || normalizedText.includes('ards')) {
    isEmergency = true;
    emergencyReason = "Severe respiratory distress or lung failure indicator detected. Immediate clinical intervention is required.";
  } else if (normalizedText.includes('hemorrhage') || normalizedText.includes('severe bleeding') || normalizedText.includes('internal bleed')) {
    isEmergency = true;
    emergencyReason = "Signs or mentions of active internal or severe hemorrhage. Urgent emergency assistance is necessary.";
  }

  const labValues = [];
  const glossary = [];
  const doctorQuestions = [];
  const lifestyleRecommendations = [];
  const references = [];

  const labDefs = [
    {
      key: 'troponin',
      name: 'Cardiac Troponin I',
      regex: /(?:troponin(?:\s+i)?)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 0,
      maxNormal: 0.04,
      unit: 'ng/mL',
      explanation: (val, status) => status === 'High' 
        ? 'Your troponin level is elevated. Troponin is a protein released when heart muscle is damaged.' 
        : 'Your troponin level is normal, suggesting no active heart muscle damage.',
      glossary: {
        term: 'Troponin',
        definition: 'A protein found in heart muscle cells. It is released into the blood only when the heart muscle is injured.',
        analogy: 'Think of troponin as a smoke detector alarm. It should be silent (low/undetectable), but goes off if there is fire (damage) in the building (heart).'
      }
    },
    {
      key: 'ldl',
      name: 'LDL Cholesterol (Bad Cholesterol)',
      regex: /(?:ldl(?:\s+cholesterol)?)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 0,
      maxNormal: 100,
      unit: 'mg/dL',
      explanation: (val, status) => status === 'High'
        ? 'Your LDL is high. High LDL (bad cholesterol) can lead to plaque build-up in your arteries.'
        : 'Your LDL cholesterol is within the healthy recommended range.',
      glossary: {
        term: 'LDL Cholesterol',
        definition: "Low-Density Lipoprotein, often called 'bad' cholesterol. It carries cholesterol into your arteries.",
        analogy: "Think of it as delivery trucks leaving packages (plaque) along the highways (blood vessels), which can cause traffic jams if there are too many."
      }
    },
    {
      key: 'hdl',
      name: 'HDL Cholesterol (Good Cholesterol)',
      regex: /(?:hdl(?:\s+cholesterol)?)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 40,
      maxNormal: 1000,
      unit: 'mg/dL',
      explanation: (val, status) => status === 'Low'
        ? 'Your HDL is low. HDL (good cholesterol) helps clear bad cholesterol from your bloodstream.'
        : 'Your HDL cholesterol is healthy, providing good cardiovascular protection.',
      glossary: {
        term: 'HDL Cholesterol',
        definition: "High-Density Lipoprotein, often called 'good' cholesterol. It helps remove other forms of cholesterol from your bloodstream.",
        analogy: "Think of it as street sweepers that clean up the garbage (excess cholesterol) from your blood vessels and take it to the liver."
      }
    },
    {
      key: 'cholesterol',
      name: 'Total Cholesterol',
      regex: /(?:total\s+cholesterol)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 0,
      maxNormal: 200,
      unit: 'mg/dL',
      explanation: (val, status) => status === 'High'
        ? 'Your total cholesterol is elevated. Keeping this low reduces cardiovascular risk.'
        : 'Your total cholesterol level is healthy.',
      glossary: {
        term: 'Total Cholesterol',
        definition: 'The overall amount of cholesterol in your blood, including LDL, HDL, and other types.',
        analogy: 'The total number of cars on the road, including delivery trucks, street sweepers, and standard cars.'
      }
    },
    {
      key: 'triglycerides',
      name: 'Triglycerides',
      regex: /(?:triglycerides|trig\b)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 0,
      maxNormal: 150,
      unit: 'mg/dL',
      explanation: (val, status) => status === 'High'
        ? 'Your triglycerides are elevated. These are a type of fat in the blood linked to heart disease risk.'
        : 'Your triglycerides are in the normal, healthy range.',
      glossary: {
        term: 'Triglycerides',
        definition: 'A type of fat (lipid) in your blood. Unused calories are converted to triglycerides and stored in fat cells.',
        analogy: 'Extra stored fuel in auxiliary tanks. If you fill up too much and don\'t burn it, the tanks overflow.'
      }
    },
    {
      key: 'hemoglobin',
      name: 'Hemoglobin',
      regex: /(?:hemoglobin|hgb|hb\b)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 12.0,
      maxNormal: 17.5,
      unit: 'g/dL',
      explanation: (val, status) => status === 'Low'
        ? 'Your hemoglobin is low, suggesting anemia, which can cause fatigue and weakness.'
        : (status === 'High' ? 'Your hemoglobin is high, which can be due to dehydration or other factors.' : 'Your hemoglobin level is healthy.'),
      glossary: {
        term: 'Hemoglobin',
        definition: 'The protein in red blood cells that carries oxygen from your lungs to the rest of your body.',
        analogy: 'Tiny cargo trains traveling through your blood, loading up oxygen in the lungs and delivering it to cells.'
      }
    },
    {
      key: 'wbc',
      name: 'White Blood Cell Count (WBC)',
      regex: /(?:wbc|white\s+blood\s+cell(?:s)?)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 4.5,
      maxNormal: 11.0,
      unit: 'x10^3/uL',
      explanation: (val, status) => status === 'High'
        ? 'Your white blood cell count is high, which often indicates your body is fighting an infection or experiencing inflammation.'
        : (status === 'Low' ? 'Your white blood cell count is low, which can make it harder to fight off infections.' : 'Your white blood cell count is within the normal range.'),
      glossary: {
        term: 'White Blood Cells',
        definition: 'Cells of the immune system that protect the body against both infectious disease and foreign invaders.',
        analogy: 'Your body\'s police force and defense department, ready to fight off foreign invaders like bacteria and viruses.'
      }
    },
    {
      key: 'rbc',
      name: 'Red Blood Cell Count (RBC)',
      regex: /(?:rbc|red\s+blood\s+cell(?:s)?)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 4.3,
      maxNormal: 5.9,
      unit: 'x10^6/uL',
      explanation: (val, status) => status === 'Low'
        ? 'Your red blood cell count is low, which can lead to fatigue due to reduced oxygen delivery.'
        : (status === 'High' ? 'Your red blood cell count is elevated.' : 'Your red blood cell count is normal.'),
      glossary: {
        term: 'Red Blood Cells',
        definition: 'Blood cells that carry oxygen from the lungs to the body tissues and carbon dioxide away as waste.',
        analogy: 'The delivery trucks of the blood, carrying oxygen to cells and bringing carbon dioxide waste back.'
      }
    },
    {
      key: 'platelets',
      name: 'Platelets (PLT)',
      regex: /(?:platelet(?:s)?|plt\b)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 150,
      maxNormal: 450,
      unit: 'x10^3/uL',
      explanation: (val, status) => status === 'Low'
        ? 'Your platelet count is low, which can affect blood clotting and increase bruising/bleeding risk.'
        : (status === 'High' ? 'Your platelet count is high, which can increase the risk of blood clots.' : 'Your platelet count is in the normal range.'),
      glossary: {
        term: 'Platelets',
        definition: 'Tiny blood cell fragments that help your body form clots to stop bleeding.',
        analogy: 'Tiny bricklayers. When there is a leak in a blood vessel, they rush to build a wall (clot) to plug it.'
      }
    },
    {
      key: 'hematocrit',
      name: 'Hematocrit',
      regex: /(?:hematocrit|hct\b)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 37.0,
      maxNormal: 52.0,
      unit: '%',
      explanation: (val, status) => status === 'Low'
        ? 'Your hematocrit is low, indicating a lower volume of red blood cells in your blood, often seen in anemia.'
        : (status === 'High' ? 'Your hematocrit is high, which can be a sign of dehydration.' : 'Your hematocrit level is normal.'),
      glossary: {
        term: 'Hematocrit',
        definition: 'The proportion of your total blood volume that is composed of red blood cells.',
        analogy: 'The thickness of your traffic. It shows what percentage of your blood is made up of red blood cell delivery trucks.'
      }
    },
    {
      key: 'glucose',
      name: 'Blood Glucose',
      regex: /(?:glucose|blood\s+sugar|glu\b)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 70,
      maxNormal: 100,
      unit: 'mg/dL',
      explanation: (val, status) => status === 'High'
        ? 'Your blood glucose is high. If fasting, this can indicate prediabetes or diabetes.'
        : (status === 'Low' ? 'Your blood glucose is low, which can lead to shakiness or fatigue.' : 'Your blood glucose is within the normal healthy range.'),
      glossary: {
        term: 'Blood Glucose',
        definition: 'The main sugar found in your blood, coming from the food you eat. It is your body\'s primary energy source.',
        analogy: 'Fuel for your car. Your cells need it to run, but too much fuel overflowing in the engine can cause long-term damage.'
      }
    },
    {
      key: 'sodium',
      name: 'Sodium',
      regex: /(?:sodium)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 135,
      maxNormal: 145,
      unit: 'mEq/L',
      explanation: (val, status) => status === 'Low'
        ? 'Your sodium is low, which can affect fluid balance and brain function.'
        : (status === 'High' ? 'Your sodium is high, which is often a sign of dehydration.' : 'Your sodium level is normal.'),
      glossary: {
        term: 'Sodium',
        definition: 'An essential electrolyte that helps maintain the balance of water in and around your cells.',
        analogy: 'The salt balance regulator. It keeps the water levels inside your body\'s cells balanced and perfect.'
      }
    },
    {
      key: 'potassium',
      name: 'Potassium',
      regex: /(?:potassium)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 3.5,
      maxNormal: 5.0,
      unit: 'mEq/L',
      explanation: (val, status) => status === 'Low'
        ? 'Your potassium is low, which can cause muscle cramps and heart rhythm issues.'
        : (status === 'High' ? 'Your potassium is high, which requires careful monitoring as it can affect heart function.' : 'Your potassium level is normal.'),
      glossary: {
        term: 'Potassium',
        definition: 'An electrolyte vital for the proper function of nerves, muscles, and the heart.',
        analogy: 'The electrical coordinator for your muscles and heart, ensuring smooth beats and contractions.'
      }
    },
    {
      key: 'chloride',
      name: 'Chloride',
      regex: /(?:chloride)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 96,
      maxNormal: 106,
      unit: 'mEq/L',
      explanation: (val, status) => status === 'Low'
        ? 'Your chloride level is low, which can be due to excessive sweating or vomiting.'
        : (status === 'High' ? 'Your chloride level is high.' : 'Your chloride level is normal.'),
      glossary: {
        term: 'Chloride',
        definition: 'An electrolyte that works with sodium and potassium to maintain proper fluid balance and acid-base balance.',
        analogy: 'Part of the fluid balance trio. It works in the background with sodium to keep cellular hydration in check.'
      }
    },
    {
      key: 'calcium',
      name: 'Calcium',
      regex: /(?:calcium)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 8.5,
      maxNormal: 10.5,
      unit: 'mg/dL',
      explanation: (val, status) => status === 'Low'
        ? 'Your calcium is low, which can impact bone and muscle health.'
        : (status === 'High' ? 'Your calcium is elevated.' : 'Your calcium level is normal.'),
      glossary: {
        term: 'Calcium',
        definition: 'A mineral necessary for bone strength, muscle contractions, and nerve signaling.',
        analogy: 'The concrete for your bones and the electrical messenger for muscle contractions.'
      }
    },
    {
      key: 'bun',
      name: 'Blood Urea Nitrogen (BUN)',
      regex: /(?:bun\b|blood\s+urea\s+nitrogen)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 7,
      maxNormal: 20,
      unit: 'mg/dL',
      explanation: (val, status) => status === 'High'
        ? 'Your BUN is high, which can suggest that your kidneys are not filtering waste efficiently, or you are dehydrated.'
        : 'Your BUN level is normal.',
      glossary: {
        term: 'BUN',
        definition: 'Blood Urea Nitrogen, a waste product created in the liver and filtered out by the kidneys.',
        analogy: 'The waste filters. High BUN is like trash piling up because the disposal system (kidneys) is running slowly or you need to flush it out with water (hydrate).'
      }
    },
    {
      key: 'creatinine',
      name: 'Creatinine',
      regex: /(?:creatinine|cr\b)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 0.6,
      maxNormal: 1.2,
      unit: 'mg/dL',
      explanation: (val, status) => status === 'High'
        ? 'Your creatinine is elevated, which can indicate that your kidneys are working harder than usual to filter waste.'
        : 'Your creatinine level is within the normal range.',
      glossary: {
        term: 'Creatinine',
        definition: 'A chemical waste molecule that is generated from muscle metabolism and filtered out by the kidneys.',
        analogy: 'A key indicator of kidney health. Think of it as a dipstick that shows how clean and effective your kidney filters are.'
      }
    },
    {
      key: 'tsh',
      name: 'Thyroid Stimulating Hormone (TSH)',
      regex: /(?:tsh\b|thyroid\s+stimulating\s+hormone)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 0.4,
      maxNormal: 4.0,
      unit: 'mIU/L',
      explanation: (val, status) => status === 'High'
        ? 'Your TSH is high, which often indicates an underactive thyroid (hypothyroidism).'
        : (status === 'Low' ? 'Your TSH is low, which often indicates an overactive thyroid (hyperthyroidism).' : 'Your TSH level is normal.'),
      glossary: {
        term: 'TSH',
        definition: 'A hormone produced by the pituitary gland that tells the thyroid gland how much thyroid hormone to release.',
        analogy: 'The thyroid thermostat. If the thyroid gland is running cold (underactive), the thermostat dials up (TSH goes high) to push it to work harder.'
      }
    },
    {
      key: 'alt',
      name: 'Alanine Aminotransferase (ALT)',
      regex: /(?:alt\b|sgpt|alanine\s+aminotransferase)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 7,
      maxNormal: 56,
      unit: 'U/L',
      explanation: (val, status) => status === 'High'
        ? 'Your ALT is elevated, which can be a sign of liver irritation or inflammation.'
        : 'Your ALT liver enzyme is in the normal range.',
      glossary: {
        term: 'ALT',
        definition: 'An enzyme found mostly in the cells of the liver. High levels in the blood can indicate liver damage.',
        analogy: 'A liver stress sensor. Think of it as a warning light that turns on when the liver cells are working under strain.'
      }
    },
    {
      key: 'ast',
      name: 'Aspartate Aminotransferase (AST)',
      regex: /(?:ast\b|sgot|aspartate\s+aminotransferase)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      minNormal: 10,
      maxNormal: 40,
      unit: 'U/L',
      explanation: (val, status) => status === 'High'
        ? 'Your AST is elevated, which can indicate liver or muscle strain.'
        : 'Your AST enzyme is in the normal range.',
      glossary: {
        term: 'AST',
        definition: 'An enzyme found in high amounts in the liver, heart, and muscle tissue.',
        analogy: 'Another stress sensor. Since it\'s found in both liver and muscles, a high value tells us to look closer at liver or muscle stress.'
      }
    }
  ];

  labDefs.forEach(def => {
    const match = text.match(def.regex);
    if (match) {
      const val = parseFloat(match[1]);
      let status = 'Normal';
      if (val < def.minNormal) {
        status = 'Low';
      } else if (val > def.maxNormal) {
        status = 'High';
      }
      
      const relevanceScore = status === 'Normal' ? 3 : (status === 'High' ? 8 : 7);
      
      labValues.push({
        name: def.name,
        value: `${val} ${def.unit}`,
        referenceRange: def.minNormal === 0 
          ? `< ${def.maxNormal} ${def.unit}` 
          : `${def.minNormal} - ${def.maxNormal} ${def.unit}`,
        status: status,
        relevanceScore: relevanceScore,
        explanation: def.explanation(val, status)
      });
      
      if (def.glossary) {
        glossary.push(def.glossary);
      }
      
      if (status !== 'Normal') {
        if (def.key === 'troponin') {
          isEmergency = true;
          emergencyReason = "Critically high Troponin level detected. This is a red-flag emergency indicator that may suggest active heart muscle damage (such as a heart attack). Seek immediate medical attention.";
        } else if (def.key === 'ldl' || def.key === 'cholesterol' || def.key === 'triglycerides') {
          if (!doctorQuestions.includes("What dietary changes are most effective for lowering my cholesterol?")) {
            doctorQuestions.push(
              "What dietary changes are most effective for lowering my cholesterol?",
              "Do you recommend starting cholesterol medication, or should we try lifestyle adjustments first?",
              "When should I repeat this blood test to check my progress?"
            );
          }
          if (!lifestyleRecommendations.includes("Focus on heart-healthy fats (like olive oil, avocados) and limit saturated and trans fats.")) {
            lifestyleRecommendations.push(
              "Focus on heart-healthy fats (like olive oil, avocados) and limit saturated and trans fats.",
              "Increase soluble fiber intake by eating more oats, beans, lentils, fruits, and vegetables.",
              "Aim for at least 150 minutes of moderate cardiovascular exercise per week."
            );
          }
          if (!references.some(r => r.sourceName === 'Mayo Clinic - High Cholesterol Info')) {
            references.push({
              sourceName: "Mayo Clinic - High Cholesterol Info",
              url: "https://www.mayoclinic.org/diseases-conditions/high-blood-cholesterol/symptoms-causes/syc-20350800"
            });
          }
        } else if (def.key === 'hemoglobin' || def.key === 'rbc' || def.key === 'hematocrit') {
          if (!doctorQuestions.includes("Could my low blood count be caused by iron deficiency or something else?")) {
            doctorQuestions.push(
              "Could my low blood count be caused by iron deficiency or something else?",
              "Should I take an iron supplement, and if so, what type and dosage?",
              "Are there other tests (like ferritin or Vitamin B12) we should run?"
            );
          }
          if (!lifestyleRecommendations.includes("Incorporate more iron-rich foods into your diet, such as spinach, red meat, beans, and iron-fortified cereals.")) {
            lifestyleRecommendations.push(
              "Incorporate more iron-rich foods into your diet, such as spinach, red meat, beans, and iron-fortified cereals.",
              "Consume Vitamin C (like oranges, strawberries) alongside iron-rich foods to boost absorption."
            );
          }
          if (!references.some(r => r.sourceName === 'CDC - Anemia Information')) {
            references.push({
              sourceName: "CDC - Anemia Information",
              url: "https://www.cdc.gov/ncbddd/blooddisorders/anemia/index.html"
            });
          }
        } else if (def.key === 'glucose') {
          doctorQuestions.push(
            "Is this blood glucose level diagnostic for prediabetes or diabetes?",
            "Do you recommend checking my HbA1c (a 3-month blood sugar average)?",
            "How can I adjust my diet and activity levels to help lower my blood sugar?"
          );
          lifestyleRecommendations.push(
            "Choose complex carbohydrates with a low glycemic index (whole grains, non-starchy vegetables) over refined sugars.",
            "Engage in regular physical activity, which helps your muscles absorb sugar out of your bloodstream."
          );
          if (!references.some(r => r.sourceName === 'WHO - Diabetes Facts')) {
            references.push({
              sourceName: "WHO - Diabetes Facts",
              url: "https://www.who.int/news-room/fact-sheets/detail/diabetes"
            });
          }
        } else if (def.key === 'creatinine' || def.key === 'bun') {
          if (!doctorQuestions.includes("Could my elevated kidney values be related to dehydration or is there another cause?")) {
            doctorQuestions.push(
              "Could my elevated kidney values be related to dehydration or is there another cause?",
              "Are there medications I should avoid to protect my kidney function (like NSAIDs)?",
              "Should we monitor my kidney function with a follow-up test?"
            );
          }
          if (!lifestyleRecommendations.includes("Ensure you stay properly hydrated by drinking water regularly throughout the day.")) {
            lifestyleRecommendations.push(
              "Ensure you stay properly hydrated by drinking water regularly throughout the day.",
              "Talk to your doctor before taking NSAID pain relievers (like ibuprofen), which can strain the kidneys."
            );
          }
          if (!references.some(r => r.sourceName === 'Mayo Clinic - Kidney Function')) {
            references.push({
              sourceName: "Mayo Clinic - Kidney Function",
              url: "https://www.mayoclinic.org/diseases-conditions/chronic-kidney-disease/symptoms-causes/syc-20354521"
            });
          }
        } else if (def.key === 'tsh') {
          doctorQuestions.push(
            "Does my TSH value suggest a thyroid disorder (like hypothyroidism or hyperthyroidism)?",
            "Should we test free T4 or other thyroid hormone levels?",
            "What symptoms should I look out for regarding thyroid dysfunction?"
          );
          lifestyleRecommendations.push(
            "Ensure you get adequate rest and manage stress, which can affect hormone balance.",
            "Discuss with your doctor whether any dietary changes or supplements are recommended for your thyroid."
          );
          if (!references.some(r => r.sourceName === 'American Thyroid Association')) {
            references.push({
              sourceName: "American Thyroid Association",
              url: "https://www.thyroid.org/thyroid-information/"
            });
          }
        } else if (def.key === 'wbc' || def.key === 'platelets') {
          if (!doctorQuestions.includes("What is the likely cause of my abnormal blood cell count?")) {
            doctorQuestions.push(
              "What is the likely cause of my abnormal blood cell count?",
              "Are there follow-up blood tests we should run to monitor this?",
              "Are there any signs or symptoms (like fever or bleeding) that should prompt immediate care?"
            );
          }
          if (!lifestyleRecommendations.includes("Focus on a diet rich in vitamins and minerals to support your immune and blood health.")) {
            lifestyleRecommendations.push(
              "Focus on a diet rich in vitamins and minerals to support your immune and blood health.",
              "Ensure good hand hygiene and avoid contact with sick individuals if your white blood cells are low."
            );
          }
          if (!references.some(r => r.sourceName === 'NIH - Blood Disorders')) {
            references.push({
              sourceName: "NIH - Blood Disorders Info",
              url: "https://www.nhlbi.nih.gov/health-topics/blood-diseases"
            });
          }
        } else if (def.key === 'alt' || def.key === 'ast') {
          if (!doctorQuestions.includes("What could be causing my elevated liver enzymes?")) {
            doctorQuestions.push(
              "What could be causing my elevated liver enzymes?",
              "Are there medications, supplements, or alcohol consumption habits I should adjust?",
              "When should we re-test my liver enzyme levels?"
            );
          }
          if (!lifestyleRecommendations.includes("Maintain a healthy diet, limit alcohol intake, and consult your doctor before starting new supplements.")) {
            lifestyleRecommendations.push(
              "Maintain a healthy diet, limit alcohol intake, and consult your doctor before starting new supplements.",
              "Engage in regular physical activity to help reduce liver fat (fatty liver risk)."
            );
          }
          if (!references.some(r => r.sourceName === 'Mayo Clinic - Liver Dysfunction')) {
            references.push({
              sourceName: "Mayo Clinic - Liver Dysfunction Info",
              url: "https://www.mayoclinic.org/symptoms/elevated-liver-enzymes/basics/definition/sym-20050830"
            });
          }
        }
      }
    }
  });

  // Generic parser for other tests in the report (position-aware tokenizing scanner)
  const numberPositions = [];
  const regexForNumbers = /\b(\d+(?:\.\d+)?)\b/g;
  let numMatch;
  while ((numMatch = regexForNumbers.exec(text)) !== null) {
    numberPositions.push({
      value: parseFloat(numMatch[1]),
      valueStr: numMatch[1],
      index: numMatch.index,
      length: numMatch[1].length
    });
  }

  const consumedIndices = new Set();
  const sepRegex = /\b(investigation|observed\s+value|value|unit|biological\s+reference\s+interval|reference\s+range|reference\s+interval|interval|range|result|test\s+name|test|biological|reference|specimen|method|technology|date|time|patient|ref|normal|flag)\b/gi;

  numberPositions.forEach((numPos, idx) => {
    if (consumedIndices.has(numPos.index)) return;

    const val = numPos.value;

    // Skip year numbers and obvious small numbers like single digits that aren't test values
    if (val >= 1900 && val <= 2100) return;

    // Skip date-like numbers (preceded or followed by slashes or dashes)
    const precedingChar = text.charAt(numPos.index - 1);
    const succeedingChar = text.charAt(numPos.index + numPos.length);
    if (precedingChar === '/' || precedingChar === '-' || succeedingChar === '/' || succeedingChar === '-') {
      return;
    }

    // Determine segments before and after the number
    const startIdx = Math.max(0, numPos.index - 120);
    const prevNumPos = idx > 0 ? numberPositions[idx - 1] : null;
    const actualStartIdx = prevNumPos ? Math.max(prevNumPos.index + prevNumPos.length, startIdx) : startIdx;
    
    let precedingText = text.substring(actualStartIdx, numPos.index);
    const endIdx = Math.min(text.length, numPos.index + numPos.length + 80);
    let succeedingText = text.substring(numPos.index + numPos.length, endIdx);

    // Extract potential units and ranges from succeedingText
    let minNormal = null;
    let maxNormal = null;
    let refRangeStr = "N/A";
    let status = "Normal";
    let unit = "";

    // Find other numbers in succeedingText to parse ranges
    const nextNumMatches = [];
    const nextNumRegex = /(\d+(?:\.\d+)?)/g;
    let nextMatch;
    while ((nextMatch = nextNumRegex.exec(succeedingText)) !== null) {
      nextNumMatches.push({
        value: parseFloat(nextMatch[1]),
        valueStr: nextMatch[1],
        index: numPos.index + numPos.length + nextMatch.index,
        length: nextMatch[1].length
      });
    }

    const nextNum = nextNumMatches.find(n => (n.index - (numPos.index + numPos.length)) < 40);
    if (nextNum) {
      const textBetween = text.substring(numPos.index + numPos.length, nextNum.index).toLowerCase();
      const secondNextNum = nextNumMatches.find(n => n.index > nextNum.index && (n.index - (nextNum.index + nextNum.length)) < 15);
      const isRange = secondNextNum && text.substring(nextNum.index + nextNum.length, secondNextNum.index).includes('-');

      if (isRange) {
        minNormal = nextNum.value;
        maxNormal = secondNextNum.value;
        refRangeStr = `${minNormal} - ${maxNormal}`;
        consumedIndices.add(nextNum.index);
        consumedIndices.add(secondNextNum.index);
        unit = textBetween.replace(/[^a-zA-Z%^*/\d-]/g, '').trim();
      } else if (textBetween.includes('<') || textBetween.includes('less')) {
        maxNormal = nextNum.value;
        refRangeStr = `< ${maxNormal}`;
        consumedIndices.add(nextNum.index);
        unit = textBetween.replace(/[^a-zA-Z%^*/\d-]/g, '').trim();
      } else if (textBetween.includes('>') || textBetween.includes('great')) {
        minNormal = nextNum.value;
        refRangeStr = `> ${minNormal}`;
        consumedIndices.add(nextNum.index);
        unit = textBetween.replace(/[^a-zA-Z%^*/\d-]/g, '').trim();
      } else {
        unit = textBetween.replace(/[^a-zA-Z%^*/\d-]/g, '').trim();
      }
    } else {
      const firstWordMatch = succeedingText.match(/^\s*([a-zA-Z%^*/\d-]+)/);
      if (firstWordMatch) {
        unit = firstWordMatch[1].trim();
      }
    }

    // Parse the test name from precedingText
    const parts = precedingText.split(sepRegex);
    let rawName = parts[parts.length - 1];

    // Clean name from symbols and spaces
    rawName = rawName.replace(/^[^a-zA-Z0-9(]+|[^a-zA-Z0-9)]+$/g, '').trim();

    if (rawName.length < 2) return;

    // Filter out dates and generic headers
    const skipTerms = [
      'patient', 'date', 'age', 'id', 'time', 'phone', 'report', 'test', 'result', 'range', 'reference', 'page', 'sex', 'gender', 'mrn', 'doctor', 'physician', 'clinic', 'hospital', 'total', 'low', 'high', 'normal',
      'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
      'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'dob'
    ];
    const rawNameLower = rawName.toLowerCase();
    if (skipTerms.includes(rawNameLower) || /^\d+$/.test(rawName)) return;

    // Discard blocks of prose that are mistakenly parsed as test names
    const proseKeywords = ['which', 'catalyses', 'oxidation', 'reactions', 'individuals', 'during', 'symptoms', 'history', 'report', 'recommendation', 'consult', 'prepare'];
    if (rawName.length > 75 || proseKeywords.some(keyword => rawNameLower.includes(keyword))) {
      return;
    }

    // Check duplicate
    const alreadyMatched = labValues.some(v => v.name.toLowerCase() === rawNameLower || rawNameLower.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(rawNameLower));
    if (alreadyMatched) return;

    // Compute status
    if (minNormal !== null && val < minNormal) {
      status = "Low";
    } else if (maxNormal !== null && val > maxNormal) {
      status = "High";
    } else {
      status = "Normal";
    }

    // Format unit
    if (unit.length > 10) unit = unit.substring(0, 10);
    const relevanceScore = status === 'Normal' ? 3 : (status === 'High' ? 8 : 7);
    const name = rawName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const explanation = status === 'High'
      ? `Your ${name} is elevated compared to the standard reference range.`
      : (status === 'Low' ? `Your ${name} is below the standard reference range.` : `Your ${name} is within the normal healthy range.`);

    labValues.push({
      name,
      value: `${val} ${unit}`,
      referenceRange: refRangeStr + (unit ? ` ${unit}` : ''),
      status,
      relevanceScore,
      explanation
    });

    glossary.push({
      term: name,
      definition: `A test measuring the level of ${name} in your body.`,
      analogy: `Think of ${name} as a component in your body's systems, which should be kept in balance.`
    });

    if (status !== 'Normal') {
      doctorQuestions.push(`What could be causing my ${name} to be ${status.toLowerCase()}?`);
      doctorQuestions.push(`Should we monitor my ${name} levels with another test?`);
      lifestyleRecommendations.push(`Consult your physician regarding steps to help manage your ${status.toLowerCase()} ${name} levels.`);
    }
  });

  if (labValues.length === 0) {
    labValues.push({
      name: "General Health Summary",
      value: "See Explanation",
      referenceRange: "N/A",
      status: "Normal",
      explanation: "No specific laboratory values were recognized automatically. The system will simplify the general clinical notes provided below."
    });
  }

  if (doctorQuestions.length === 0) {
    doctorQuestions.push(
      "What do these overall results mean for my health?",
      "Are there any changes I need to make to my lifestyle based on this report?",
      "When do I need to follow up next?"
    );
  }

  if (lifestyleRecommendations.length === 0) {
    lifestyleRecommendations.push(
      "Maintain a balanced diet rich in vegetables, lean proteins, and whole grains.",
      "Stay hydrated by drinking plenty of water throughout the day.",
      "Aim for 7 to 8 hours of quality sleep each night to help your body recover."
    );
  }

  if (references.length === 0) {
    references.push({
      sourceName: "PubMed Central (PMC)",
      url: "https://www.ncbi.nlm.nih.gov/pmc/"
    });
  }

  const highValues = labValues.filter(v => v.status === 'High').map(v => v.name);
  const lowValues = labValues.filter(v => v.status === 'Low').map(v => v.name);
  
  let dynamicSummary = "";
  if (highValues.length > 0 || lowValues.length > 0) {
    dynamicSummary = "We analyzed your report and identified some areas that may need attention. ";
    if (highValues.length > 0) {
      dynamicSummary += `Specifically, we noticed elevated levels for: ${highValues.join(', ')}. `;
    }
    if (lowValues.length > 0) {
      dynamicSummary += `We also found lower-than-normal levels for: ${lowValues.join(', ')}. `;
    }
    dynamicSummary += "Please review the details below and discuss these results with your doctor.";
  } else if (labValues.length > 0 && labValues[0].name !== "General Health Summary") {
    dynamicSummary = "We analyzed your report and found that all recognized laboratory values (including " + 
                     labValues.map(v => v.name).join(', ') + 
                     ") are within the standard reference ranges.";
  } else {
    dynamicSummary = "We've scanned your report, but did not recognize any standard laboratory test values automatically. Please review the raw text below or upload a report with standard metrics (like Lipids, CBC, or CMP values) for a detailed breakdown.";
  }

  return {
    isEmergency,
    emergencyReason,
    simplifiedSummary: dynamicSummary,
    labValues,
    glossary,
    doctorQuestions,
    lifestyleRecommendations,
    references
  };
}

// Prompt creation function
function buildAnalysisPrompt(reportText) {
  return `You are an expert medical educator and simplifier. 
Analyze the following raw medical report text and generate a patient-friendly summary, laboratory value breakdown, simplified medical glossary, emergency indicators, questions for their doctor, lifestyle recommendations, and trusted references.

IMPORTANT SAFETY INSTRUCTIONS:
- Do NOT prescribe medication.
- Do NOT diagnose a specific disease (express findings as 'elevated', 'decreased', or 'suggestive of', not absolute diagnosis).
- Do NOT replace a doctor.
- If findings indicate a red-flag life-threatening emergency (e.g. troponin indicating heart attack, stroke signs, severe hemorrhage, severe hypoxia/respiratory failure, sepsis), set "isEmergency" to true and provide an urgent explanation.

Format your response EXACTLY as a JSON object, with no other text, wrapping, or markdown outside the JSON, matching this schema:
{
  "isEmergency": boolean,
  "emergencyReason": "string describing the life-threatening emergency found, or null if normal",
  "simplifiedSummary": "A clear, empathetic, 2-3 sentence overview of the main findings in easy-to-understand language.",
  "labValues": [
    {
      "name": "Full Test Name (e.g. LDL Cholesterol)",
      "value": "Patient value with units (e.g. 180 mg/dL)",
      "referenceRange": "Normal reference range with units (e.g. < 100 mg/dL)",
      "status": "Normal" | "Low" | "High",
      "explanation": "A simple 1-2 sentence translation of what this means and why it matters."
    }
  ],
  "glossary": [
    {
      "term": "Medical jargon term used in report",
      "definition": "Simple definition in lay terms.",
      "analogy": "A simple real-world analogy to help the patient visualize it (e.g., comparing blood vessels to pipes or hemoglobin to cargo trains)."
    }
  ],
  "doctorQuestions": [
    "Question 1 to print and ask the doctor",
    "Question 2 to print and ask the doctor"
  ],
  "lifestyleRecommendations": [
    "Evidence-based lifestyle/nutrition/wellness suggestion related to findings"
  ],
  "references": [
    {
      "sourceName": "Mayo Clinic" | "CDC" | "WHO" | "PubMed",
      "url": "A direct or general website link to educational resources from this source"
    }
  ]
}

Ensure the glossary contains at least 2-3 medical jargon words found in the text.
Use simple, clear, compassionate language suitable for an 8th-grade reading level.

Raw Medical Report Text:
"${reportText}"
`;
}

// POST endpoint to analyze report text
app.post('/api/analyze', async (req, res) => {
  const { text, apiKey, apiProvider } = req.body;

  if (!text || text.trim() === "") {
    return res.status(400).json({ error: "No report text provided." });
  }

  // Determine which API key and provider to use (custom client-supplied vs server env-supplied)
  const provider = apiProvider || (process.env.OPENAI_API_KEY ? 'openai' : (process.env.GEMINI_API_KEY ? 'gemini' : 'local'));
  const activeKey = apiKey || (provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY);

  console.log(`Analyzing report text using provider: ${provider}`);

  if (provider === 'local' || !activeKey) {
    console.log("No API key available. Falling back to local rules parser.");
    try {
      const localResult = fallbackLocalAnalysis(text);
      return res.json(localResult);
    } catch (err) {
      console.error("Local fallback failed:", err);
      return res.status(500).json({ error: "Failed to parse report locally." });
    }
  }

  // AI-Based analysis
  const prompt = buildAnalysisPrompt(text);

  try {
    if (provider === 'gemini') {
      const genAI = new GoogleGenerativeAI(activeKey);
      // Use gemini-1.5-flash for speed and reliability in json schema
      const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" }
      });
      const result = await model.generateContent(prompt);
      const rawResponse = result.response.text();
      const parsedData = cleanJSONResponse(rawResponse);
      return res.json(parsedData);
    } else if (provider === 'openai') {
      const openai = new OpenAI({ apiKey: activeKey });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      });
      const rawResponse = completion.choices[0].message.content;
      const parsedData = cleanJSONResponse(rawResponse);
      return res.json(parsedData);
    }
  } catch (err) {
    console.error("AI Analysis error:", err);
    console.log("Gracefully falling back to local analysis on AI service failure.");
    try {
      const localResult = fallbackLocalAnalysis(text);
      return res.json({
        ...localResult,
        warning: "AI service failed or timed out. Showing local parser results instead."
      });
    } catch (fallbackErr) {
      return res.status(500).json({ error: "Failed to process medical report." });
    }
  }
});

// Ping endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: "healthy", time: new Date() });
});

app.listen(PORT, () => {
  console.log(`MedSimplify AI backend listening on port ${PORT}`);
});
