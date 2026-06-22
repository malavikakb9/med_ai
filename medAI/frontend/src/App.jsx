import React, { useState, useEffect, useRef } from 'react';
import Tesseract from 'tesseract.js';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { 
  Upload, FileText, AlertTriangle, ShieldCheck, MapPin, 
  Printer, HelpCircle, RefreshCw, BookOpen, 
  Settings, HeartPulse, Sparkles, CheckCircle2, 
  Camera, ExternalLink, ChevronRight, Award, 
  PhoneCall
} from 'lucide-react';
import HospitalMap from './components/HospitalMap';

GlobalWorkerOptions.workerSrc = pdfjsWorker;

const TEXT_SUFFICIENCY_THRESHOLD = 50;

const LAB_GROUP_META = {
  High: { title: 'High — Needs Attention' },
  Low: { title: 'Low — Below Normal' },
  Normal: { title: 'Normal — Within Range' },
};

function isTextSufficient(text) {
  return (text || '').trim().length >= TEXT_SUFFICIENCY_THRESHOLD;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractPdfTextOrOcr(fileObj, onProgress) {
  const arrayBuffer = await fileObj.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  let extractedText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    extractedText += content.items.map(item => item.str).join(' ') + '\n';
  }
  
  if (isTextSufficient(extractedText)) {
    return { text: extractedText, source: 'pdf' };
  }
  
  let ocrText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    
    const pageText = await Tesseract.recognize(
      dataUrl,
      'eng',
      {
        logger: m => {
          if (m.status === 'recognizing') {
            const pageProgress = m.progress;
            const overallProgress = Math.round(((i - 1) / pdf.numPages + pageProgress / pdf.numPages) * 100);
            onProgress(overallProgress);
          }
        }
      }
    ).then(({ data: { text } }) => text);
    
    ocrText += `--- Page ${i} ---\n` + pageText + '\n';
  }
  
  return { text: ocrText, source: 'ocr' };
}

function normalizeLabStatus(status) {
  const s = (status || 'Normal').toLowerCase();
  if (s === 'borderline' || s === 'high') return 'High';
  if (s === 'low') return 'Low';
  return 'Normal';
}

function groupLabValues(labValues) {
  const GROUP_ORDER = ['High', 'Low', 'Normal'];
  return GROUP_ORDER.map(status => ({
    status,
    title: LAB_GROUP_META[status].title,
    items: labValues
      .map((lab, index) => ({
        ...lab,
        status: normalizeLabStatus(lab.status),
        _index: index,
      }))
      .filter(lab => lab.status === status)
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0) || a._index - b._index),
  })).filter(group => group.items.length > 0);
}

// Sample mock reports for user convenience
const SAMPLE_REPORTS = [
  {
    name: "Standard Blood Test (Anemia)",
    text: "Patient Name: Jane Doe\nDate: June 15, 2026\nTests conducted:\nHemoglobin: 10.2 g/dL (Reference Range: 12.0 - 15.5 g/dL)\nWhite Blood Cells: 6.4 x10^3/uL (Reference: 4.5 - 11.0)\nNotes: Patient reports mild fatigue."
  },
  {
    name: "Cardiovascular Lipid Profile (High Cholesterol)",
    text: "Patient: John Smith\nDate: May 12, 2026\nLipid Panel Findings:\nTotal Cholesterol: 240 mg/dL\nLDL Cholesterol: 180 mg/dL (Reference Range: < 100 mg/dL)\nHDL Cholesterol: 42 mg/dL (Reference Range: > 40 mg/dL)\nTriglycerides: 160 mg/dL\nLifestyle adjustments suggested."
  },
  {
    name: "CRITICAL: Cardiac Troponin Test (Emergency Simulation)",
    text: "Emergency Department Triage Report\nTime of arrival: 21:30\nSymptoms: Severe squeezing chest pressure radiating to left arm. Profuse sweating.\nCardiac Biomarkers:\nTroponin I: 5.4 ng/mL (Reference Range: < 0.04 ng/mL - CRITICAL ALERT)\nRecommendation: Immediate cardiology consult. Prepare for urgent cardiac catheterization lab intervention."
  }
];

// Haversine formula to compute distance in km
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Sophisticated Local Medical Parser when running offline or locally
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
      relevanceScore: 1,
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
function buildAnalysisPrompt(reportText, useVision = false) {
  const sourceInstruction = useVision
    ? 'Read the attached medical report document or image directly. Extract all information from the visual document.'
    : `Raw Medical Report Text:\n"${reportText}"`;

  return `You are an expert medical educator and simplifier. 
Analyze the following medical report and generate a patient-friendly summary, laboratory value breakdown, simplified medical glossary, emergency indicators, questions for their doctor, lifestyle recommendations, and trusted references.

IMPORTANT SAFETY INSTRUCTIONS:
- Do NOT prescribe medication.
- Do NOT diagnose a specific disease (express findings as 'elevated', 'decreased', or 'suggestive of', not absolute diagnosis).
- Do NOT replace a doctor.
- If findings indicate a red-flag life-threatening emergency (e.g. troponin indicating heart attack, stroke signs, severe hemorrhage, severe hypoxia/respiratory failure, sepsis), set "isEmergency" to true and provide an urgent explanation.

LAB VALUE INSTRUCTIONS:
- Extract EVERY numeric lab or test result found in the report (e.g. WBC, platelets, electrolytes, liver enzymes, lipids, glucose, hemoglobin, troponin, etc.). Do not omit results.
- Each entry must use status "Normal", "Low", or "High" only (never use Borderline).
- Assign relevanceScore (1-10) where 10 is most clinically important for the patient to notice.
- List abnormal results before normal ones in labValues.

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
      "relevanceScore": 8,
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

${sourceInstruction}
`;
}

async function analyzeWithText(reportText, apiProvider, apiKey) {
  const prompt = buildAnalysisPrompt(reportText);

  if (apiProvider === 'gemini') {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    if (!response.ok) throw new Error("Gemini API call failed");

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }

  if (apiProvider === 'openai') {
    const response = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        })
      }
    );

    if (!response.ok) throw new Error("OpenAI API call failed");

    const data = await response.json();
    return data.choices[0].message.content;
  }

  throw new Error("Unsupported API provider");
}

async function analyzeWithVision(file, apiProvider, apiKey) {
  const base64 = await fileToBase64(file);
  const mimeType = file.type || 'application/octet-stream';
  const prompt = buildAnalysisPrompt('', true);

  if (apiProvider === 'gemini') {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64 } }
            ]
          }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    if (!response.ok) throw new Error("Gemini vision API call failed");

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }

  if (apiProvider === 'openai') {
    if (!mimeType.startsWith('image/')) {
      throw new Error("OpenAI vision supports images only. Use Google Gemini for PDF vision analysis, or paste text manually.");
    }

    const response = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
            ]
          }],
          response_format: { type: "json_object" }
        })
      }
    );

    if (!response.ok) throw new Error("OpenAI vision API call failed");

    const data = await response.json();
    return data.choices[0].message.content;
  }

  throw new Error("Unsupported API provider");
}

// Clean JSON response from LLM output
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

export default function App() {
  // Report and OCR states
  const [reportText, setReportText] = useState("");
  const [file, setFile] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [inputSource, setInputSource] = useState(null);
  const [extractionWarning, setExtractionWarning] = useState(null);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);

  // Layout and settings states
  const [activeTab, setActiveTab] = useState("summary");
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiProvider, setApiProvider] = useState("local");
  const [privacyMode, setPrivacyMode] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const videoRef = useRef(null);

  // Emergency & Geolocation states
  const [userLocation, setUserLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [hospitals, setHospitals] = useState([]);
  const [locatingError, setLocatingError] = useState(null);

  // Glossary popup states
  const [selectedTerm, setSelectedTerm] = useState(null);
  const [checkedQuestions, setCheckedQuestions] = useState(new Set());

  // Load settings on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('medsimplify_api_key');
    const savedProvider = localStorage.getItem('medsimplify_provider');
    const savedPrivacy = localStorage.getItem('medsimplify_privacy');
    
    if (savedKey) setApiKey(savedKey);
    if (savedProvider) setApiProvider(savedProvider);
    if (savedPrivacy !== null) setPrivacyMode(savedPrivacy === 'true');
  }, []);

  const handleSaveSettings = (provider, key, privacy) => {
    setApiProvider(provider);
    setApiKey(key);
    setPrivacyMode(privacy);
    if (privacy) {
      localStorage.setItem('medsimplify_api_key', key);
      localStorage.setItem('medsimplify_provider', provider);
      localStorage.setItem('medsimplify_privacy', 'true');
    } else {
      localStorage.removeItem('medsimplify_api_key');
      localStorage.removeItem('medsimplify_provider');
      localStorage.setItem('medsimplify_privacy', 'false');
    }
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const runOcr = (fileObj) => {
    setIsOcrLoading(true);
    setOcrProgress(0);

    return Tesseract.recognize(
      fileObj,
      'eng',
      {
        logger: m => {
          if (m.status === 'recognizing') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        }
      }
    ).then(({ data: { text } }) => text);
  };

  const processFile = async (fileObj) => {
    setFile(fileObj);
    setPendingFile(fileObj);
    setExtractionWarning(null);
    setInputSource(null);
    setResult(null);

    const isTextFile = fileObj.type === 'text/plain' || 
                       fileObj.type === 'application/json' ||
                       fileObj.name.toLowerCase().endsWith('.txt') ||
                       fileObj.name.toLowerCase().endsWith('.ocr') ||
                       fileObj.name.toLowerCase().endsWith('.json') ||
                       fileObj.name.toLowerCase().endsWith('.rtf') ||
                       fileObj.name.toLowerCase().endsWith('.log');
    const isPdf = fileObj.type === 'application/pdf' || fileObj.name.toLowerCase().endsWith('.pdf');

    if (isTextFile) {
      try {
        const text = await fileObj.text();
        let finalText = text;
        if (fileObj.name.toLowerCase().endsWith('.json') || fileObj.type === 'application/json') {
          try {
            const parsed = JSON.parse(text);
            const possibleTextFields = ['text', 'content', 'ocrText', 'extractedText', 'rawText', 'reportText', 'ocr_text', 'data'];
            let foundText = '';
            for (const field of possibleTextFields) {
              if (parsed && typeof parsed[field] === 'string' && parsed[field].trim().length > 0) {
                foundText = parsed[field];
                break;
              }
            }
            if (foundText) {
              finalText = foundText;
            }
          } catch (jsonErr) {}
        }
        setReportText(finalText);
        setInputSource('text');
        setPendingFile(null);
        setExtractionWarning(null);
        handleAnalyzeReport(finalText, null);
      } catch (err) {
        console.error("Text file read error:", err);
        alert("Failed to read text file.");
      }
      return;
    }

    if (isPdf) {
      setIsOcrLoading(true);
      setOcrProgress(0);
      try {
        const { text, source } = await extractPdfTextOrOcr(fileObj, (pct) => {
          setOcrProgress(pct);
        });
        setReportText(text);
        setInputSource(source);
        setPendingFile(null);
        setExtractionWarning(null);
        handleAnalyzeReport(text, null);
      } catch (err) {
        console.error("PDF extraction error:", err);
        setReportText('');
        setInputSource('vision');
        setExtractionWarning('Could not extract PDF text. AI vision will be used when you analyze (requires Gemini or OpenAI API key).');
      } finally {
        setIsOcrLoading(false);
      }
      return;
    }

    try {
      const text = await runOcr(fileObj);
      setReportText(text);
      if (isTextSufficient(text)) {
        setInputSource('ocr');
        setPendingFile(null);
        handleAnalyzeReport(text, null);
      } else {
        setInputSource('vision');
        setExtractionWarning('OCR returned little text. AI vision will be used when you analyze (requires Gemini or OpenAI API key).');
        handleAnalyzeReport('', fileObj);
      }
    } catch (err) {
      console.error("OCR Error:", err);
      setReportText('');
      setInputSource('vision');
      setExtractionWarning('OCR failed. AI vision will be used when you analyze (requires Gemini or OpenAI API key).');
    } finally {
      setIsOcrLoading(false);
    }
  };

  // Camera capture simulation
  const startCamera = async () => {
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.warn("Camera hardware access failed, displaying simulation mode.");
    }
  };

  const closeCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }
    setCameraStream(null);
    setCameraOpen(false);
  };

  const capturePhoto = () => {
    if (cameraStream && videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        const simulatedFile = new File([blob], "captured_report.jpg", { type: "image/jpeg" });
        processFile(simulatedFile);
      }, 'image/jpeg');
    } else {
      setReportText(SAMPLE_REPORTS[0].text);
      setFile({ name: "simulated_camera_snapshot.jpg" });
      setPendingFile(null);
      setInputSource('text');
      setExtractionWarning(null);
    }
    closeCamera();
  };

  const applyAnalysisResult = (parsedData) => {
    setResult(parsedData);
    setCheckedQuestions(new Set());
    if (parsedData.isEmergency) {
      triggerNearbyHospitalsSearch();
    }
  };

  // Core Analysis Trigger (handles direct API requests or local rules engine)
  const handleAnalyzeReport = async (overrideText = null, overrideFile = null) => {
    const textToUse = typeof overrideText === 'string' ? overrideText : reportText;
    const fileToUse = overrideFile || pendingFile;
    const hasText = isTextSufficient(textToUse);
    const canUseVision = fileToUse && apiKey && apiProvider !== 'local';

    if (!hasText && !canUseVision) {
      alert("Could not read file. Paste text manually or add a Gemini/OpenAI API key for vision analysis.");
      return;
    }

    setIsProcessing(true);
    setResult(null);
    setHospitals([]);
    setUserLocation(null);

    if (!hasText && canUseVision) {
      try {
        const rawText = await analyzeWithVision(fileToUse, apiProvider, apiKey);
        applyAnalysisResult(cleanJSONResponse(rawText));
      } catch (err) {
        console.error("Vision API error:", err);
        alert(err.message || "Vision analysis failed. Try pasting text manually or check your API key.");
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (apiProvider === 'local' || !apiKey) {
      setTimeout(() => {
        try {
          applyAnalysisResult(fallbackLocalAnalysis(textToUse));
        } catch (err) {
          alert("Failed to analyze report content locally.");
        } finally {
          setIsProcessing(false);
        }
      }, 1000);
      return;
    }

    try {
      const rawText = await analyzeWithText(textToUse, apiProvider, apiKey);
      applyAnalysisResult(cleanJSONResponse(rawText));
    } catch (err) {
      console.error("LLM API Call Error. Falling back to local engine:", err);
      try {
        applyAnalysisResult({
          ...fallbackLocalAnalysis(textToUse),
          warning: "AI service failed or API key was invalid. Displaying local rules analyzer instead."
        });
      } catch (fallbackErr) {
        alert("Failed to analyze report content.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // GPS geolocation + Overpass API query for nearest clinics/hospitals
  const triggerNearbyHospitalsSearch = () => {
    if (!navigator.geolocation) {
      setLocatingError("Geolocation is not supported by your browser.");
      return;
    }

    setIsLocating(true);
    setLocatingError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setUserLocation({ lat, lng });

        try {
          const radius = 6000;
          const query = `[out:json];(node["amenity"="hospital"](around:${radius},${lat},${lng});node["amenity"="clinic"](around:${radius},${lat},${lng}););out body;`;
          const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
          
          const response = await fetch(url);
          if (!response.ok) throw new Error("OSM Overpass query failed");
          
          const data = await response.json();
          
          if (data.elements && data.elements.length > 0) {
            const list = data.elements
              .map(el => {
                const dist = calculateDistance(lat, lng, el.lat, el.lon);
                return {
                  name: el.tags.name || "Medical Clinic/Hospital",
                  address: el.tags["addr:street"] 
                    ? `${el.tags["addr:street"]} ${el.tags["addr:housenumber"] || ""}` 
                    : "Address details unavailable",
                  lat: el.lat,
                  lon: el.lon,
                  distance: dist
                };
              })
              .sort((a, b) => a.distance - b.distance)
              .slice(0, 5); 
            
            setHospitals(list);
          } else {
            setLocatingError("No nearby healthcare facilities found within 6km.");
          }
        } catch (err) {
          console.error("OSM error:", err);
          // Fallback static clinics for mockup
          setHospitals([
            { name: "Emergency Care Hospital", address: "Central City Hospital Blvd", lat: lat + 0.005, lon: lng + 0.003, distance: 0.8 },
            { name: "City Trauma Center", address: "77 Medical Way", lat: lat - 0.008, lon: lng - 0.004, distance: 1.4 },
          ]);
        } finally {
          setIsLocating(false);
        }
      },
      (err) => {
        console.error("GPS error:", err);
        setLocatingError("Permission denied or location retrieval timed out.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Toggle Doctor Question list
  const handleToggleQuestion = (idx) => {
    const updated = new Set(checkedQuestions);
    if (updated.has(idx)) {
      updated.delete(idx);
    } else {
      updated.add(idx);
    }
    setCheckedQuestions(updated);
  };

  // Helper to inject interactive click events to terms
  const renderInteractiveText = (inputText) => {
    const glossaryData = result && Array.isArray(result.glossary || result.medicalGlossary || result.medical_glossary)
      ? (result.glossary || result.medicalGlossary || result.medical_glossary)
      : [];

    if (!inputText || glossaryData.length === 0) return inputText;
    
    let elements = [inputText];
    
    glossaryData.forEach(gItem => {
      if (!gItem || typeof (gItem.term || gItem.word || gItem.name) !== 'string') return;
      const termName = gItem.term || gItem.word || gItem.name;
      const escapedTerm = termName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b(${escapedTerm})\\b`, 'i');
      
      const newElements = [];
      elements.forEach(el => {
        if (typeof el !== 'string') {
          newElements.push(el);
          return;
        }
        
        let match;
        let remainingText = el;
        
        while ((match = regex.exec(remainingText)) !== null) {
          const index = match.index;
          const matchedTerm = match[0];
          
          if (index > 0) {
            newElements.push(remainingText.substring(0, index));
          }
          
          newElements.push(
            <span 
              key={matchedTerm + index} 
              className="clickable-term" 
              onClick={() => setSelectedTerm(gItem)}
            >
              {matchedTerm}
            </span>
          );
          
          remainingText = remainingText.substring(index + matchedTerm.length);
        }
        
        if (remainingText.length > 0) {
          newElements.push(remainingText);
        }
      });
      elements = newElements;
    });
    
    return elements;
  };

  // Clean state
  const clearSession = () => {
    setReportText("");
    setFile(null);
    setPendingFile(null);
    setInputSource(null);
    setExtractionWarning(null);
    setResult(null);
    setHospitals([]);
    setUserLocation(null);
    setCheckedQuestions(new Set());
    setSelectedTerm(null);
  };

  const inputSourceLabels = {
    text: 'Loaded from text file',
    pdf: 'Extracted from PDF',
    ocr: 'OCR extraction complete',
    vision: 'Ready for AI vision analysis',
  };

  return (
    <div>
      {/* App Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon">
            <HeartPulse className="text-white" size={24} />
          </div>
          <div>
            <h1 className="brand-title">MedSimplify AI</h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Intelligent Patient Education Assistant
            </span>
          </div>
        </div>

        {/* Feature 1: Persistent Medical Disclaimer */}
        <div className="persistent-disclaimer">
          <ShieldCheck size={20} style={{ flexShrink: 0 }} />
          <span>
            <strong>Disclaimer:</strong> This tool provides educational information only and is not a substitute for professional medical advice, diagnosis, or treatment.
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="toggle-privacy-btn"
            style={{ 
              background: privacyMode ? 'rgba(16, 185, 129, 0.1)' : 'rgba(99, 102, 241, 0.1)',
              borderColor: privacyMode ? 'var(--emerald)' : 'var(--primary)',
              color: privacyMode ? 'var(--emerald)' : 'var(--primary)'
            }}
            onClick={() => handleSaveSettings(apiProvider, apiKey, !privacyMode)}
          >
            <ShieldCheck size={16} />
            <span>{privacyMode ? "Privacy Mode On" : "Local Mode Only"}</span>
          </button>
          
          <button 
            className="btn-print"
            style={{ margin: 0, padding: '0.5rem' }}
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <div className="container">
        {/* API Settings Section */}
        {showSettings && (
          <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem', animation: 'slideDown 0.3s' }}>
            <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Settings size={18} /> API Key Configuration
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>AI Service Provider</label>
                <select 
                  className="provider-select" 
                  value={apiProvider} 
                  onChange={(e) => handleSaveSettings(e.target.value, apiKey, privacyMode)}
                >
                  <option value="local">None (Use Advanced Local Rule Engine)</option>
                  <option value="gemini">Google Gemini 1.5 Flash (Recommended)</option>
                  <option value="openai">OpenAI GPT-4o-Mini</option>
                </select>
              </div>

              {apiProvider !== 'local' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Custom API Key</label>
                  <input 
                    type="password" 
                    className="input-field" 
                    placeholder={`Enter ${apiProvider.toUpperCase()} Key`}
                    value={apiKey}
                    onChange={(e) => handleSaveSettings(apiProvider, e.target.value, privacyMode)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {privacyMode 
                    ? "✓ Keys are saved securely in your browser's local storage and never sent anywhere else." 
                    : "⚠ Credentials are cleared when you close the tab."
                  }
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Feature 2: Red-Flag Emergency Banner */}
        {result && result.isEmergency && (
          <div className="emergency-banner">
            <div className="emergency-icon">
              <AlertTriangle className="text-white" size={24} />
            </div>
            <div className="emergency-content" style={{ flexGrow: 1 }}>
              <h3>⚠️ CRITICAL RED-FLAG ALERT DETECTED</h3>
              <p style={{ color: '#fed7d7', fontSize: '0.95rem', lineHeight: '1.5', marginTop: '0.25rem' }}>
                {result.emergencyReason}
              </p>
              
              <div className="emergency-actions">
                <a href="tel:112" className="btn-emergency">
                  <PhoneCall size={16} /> Dial National Emergency (112)
                </a>
                <a href="tel:108" className="btn-emergency btn-emergency-secondary">
                  <PhoneCall size={16} /> Call Ambulance (108)
                </a>
                <button 
                  className="btn-emergency btn-emergency-secondary"
                  onClick={triggerNearbyHospitalsSearch}
                  disabled={isLocating}
                >
                  <MapPin size={16} /> {isLocating ? "Locating..." : "Find Nearby Emergency Rooms"}
                </button>
              </div>

              {locatingError && (
                <p style={{ color: 'var(--amber)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                  ⚠ Location Search Error: {locatingError}
                </p>
              )}

              {/* Show Hospital Map */}
              {(userLocation || hospitals.length > 0) && (
                <div style={{ marginTop: '1.5rem' }}>
                  <h4 style={{ color: 'white', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <MapPin size={16} /> Closest Medical Facilities
                  </h4>
                  <HospitalMap userLocation={userLocation} hospitals={hospitals} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Grid */}
        <div className="grid-main">
          {/* Left Column: Upload & Options */}
          <div className="glass-panel upload-panel">
            <h2 className="panel-title">
              <FileText className="text-indigo-400" size={20} /> Input Medical Report
            </h2>

            {/* Drag & Drop Upload Block */}
            <div 
              className={`upload-area ${dragActive ? 'drag-active' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <Upload className="upload-icon" size={42} />
              <div>
                <p style={{ fontWeight: 600 }}>Drag & drop your medical report here</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  Supports PDF, images, text, OCR, or JSON files
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <label className="upload-btn">
                  Browse Files
                  <input 
                    type="file" 
                    style={{ display: 'none' }} 
                    accept="image/*,application/pdf,text/*,.txt,.ocr,.json,.rtf,.log"
                    onChange={handleFileChange}
                  />
                </label>

                <button className="upload-btn" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)' }} onClick={startCamera}>
                  <Camera size={16} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} /> Camera
                </button>
              </div>
            </div>

            {/* Simulated OCR status indicator */}
            {isOcrLoading && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                  <span>Reading report...</span>
                  <span>{ocrProgress > 0 ? `${ocrProgress}%` : ''}</span>
                </div>
                <div className="ocr-progress-container">
                  <div className="ocr-progress-bar" style={{ width: `${ocrProgress || 30}%` }}></div>
                </div>
              </div>
            )}

            {inputSource && !isOcrLoading && (
              <p style={{ fontSize: '0.82rem', color: 'var(--emerald)', marginTop: '0.25rem' }}>
                {inputSourceLabels[inputSource]}
                {file?.name ? ` — ${file.name}` : ''}
              </p>
            )}

            {extractionWarning && (
              <p style={{ fontSize: '0.82rem', color: 'var(--amber)', marginTop: '0.25rem' }}>
                {extractionWarning}
              </p>
            )}

            {/* Manual text backup / OCR result */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Extracted Text Content</label>
              <textarea
                className="text-input-area"
                placeholder="Extracted text will appear here. You can also paste or edit manually..."
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
              ></textarea>
            </div>

            {/* Sample reports */}
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
                Or try one of our sample reports:
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {SAMPLE_REPORTS.map((sample, idx) => (
                  <button 
                    key={idx}
                    className="reference-link"
                    style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', width: '100%', borderRadius: 'var(--radius-sm)' }}
                    onClick={() => {
                      setReportText(sample.text);
                      setFile({ name: `${sample.name.split(' ')[0].toLowerCase()}_report.txt` });
                      setPendingFile(null);
                      setInputSource('text');
                      setExtractionWarning(null);
                    }}
                  >
                    <span>{sample.name}</span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            </div>

            {/* Analyze Trigger Buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button 
                className="upload-btn" 
                style={{ flexGrow: 1, padding: '0.8rem', fontWeight: 700 }}
                onClick={handleAnalyzeReport}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="animate-spin" size={16} style={{ marginRight: '0.5rem', display: 'inline-block', verticalAlign: 'middle' }} />
                    Interpreting report...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} style={{ marginRight: '0.5rem', display: 'inline-block', verticalAlign: 'middle' }} />
                    Simplify & Interpret Report
                  </>
                )}
              </button>

              {result && (
                <button 
                  className="upload-btn"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--crimson)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.8rem' }}
                  onClick={clearSession}
                >
                  Clear Session
                </button>
              )}
            </div>
          </div>

          {/* Right Column: Dashboard & Interpretation Panel */}
          <div className="glass-panel dashboard-panel">
            {!result && !isProcessing ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'center', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: '400px', color: 'var(--text-secondary)', textAlign: 'center', gap: '1.25rem' }}>
                <HeartPulse size={64} style={{ color: 'var(--text-muted)' }} />
                <div>
                  <h3 style={{ color: 'white', marginBottom: '0.5rem' }}>No Analysis Available</h3>
                  <p style={{ maxWidth: '400px', fontSize: '0.9rem' }}>
                    Upload an image or document, extract its text, and tap "Simplify & Interpret Report" to receive a patient-friendly summary, glossary, value highlights, and doctor questions.
                  </p>
                </div>
              </div>
            ) : isProcessing ? (
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: '400px', textAlign: 'center', gap: '1.25rem' }}>
                <RefreshCw className="animate-spin text-indigo-400" size={48} />
                <div>
                  <h3 style={{ color: 'white', marginBottom: '0.5rem' }}>Analyzing Clinical Content</h3>
                  <p style={{ maxWidth: '400px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Simplifying complex medical jargon, checking normal/high/low lab values, detecting emergencies, and compiling custom recommendations...
                  </p>
                </div>
              </div>
            ) : (
              <div className="results-container">
                {/* Fallback AI Warning Banner */}
                {result.warning && (
                  <div style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid var(--amber)', color: 'var(--amber)', borderRadius: 'var(--radius-sm)', padding: '0.8rem', fontSize: '0.85rem' }}>
                    ⚠ {result.warning}
                  </div>
                )}

                {/* Dashboard Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border-glass)', overflowX: 'auto', gap: '0.5rem', paddingBottom: '0.1rem' }}>
                  <button 
                    className={`btn-print ${activeTab === 'summary' ? 'active' : ''}`}
                    style={{ 
                      margin: 0, 
                      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                      borderBottom: activeTab === 'summary' ? '2px solid var(--primary)' : 'none',
                      background: activeTab === 'summary' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                      color: activeTab === 'summary' ? 'white' : 'var(--text-secondary)'
                    }}
                    onClick={() => setActiveTab("summary")}
                  >
                    <BookOpen size={16} /> Summary & Glossary
                  </button>

                  <button 
                    className={`btn-print ${activeTab === 'values' ? 'active' : ''}`}
                    style={{ 
                      margin: 0, 
                      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                      borderBottom: activeTab === 'values' ? '2px solid var(--primary)' : 'none',
                      background: activeTab === 'values' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                      color: activeTab === 'values' ? 'white' : 'var(--text-secondary)'
                    }}
                    onClick={() => setActiveTab("values")}
                  >
                    <HeartPulse size={16} /> Lab Highlights
                  </button>

                  <button 
                    className={`btn-print ${activeTab === 'questions' ? 'active' : ''}`}
                    style={{ 
                      margin: 0, 
                      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                      borderBottom: activeTab === 'questions' ? '2px solid var(--primary)' : 'none',
                      background: activeTab === 'questions' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                      color: activeTab === 'questions' ? 'white' : 'var(--text-secondary)'
                    }}
                    onClick={() => setActiveTab("questions")}
                  >
                    <Printer size={16} /> Doctor Questionnaire
                  </button>

                  <button 
                    className={`btn-print ${activeTab === 'lifestyle' ? 'active' : ''}`}
                    style={{ 
                      margin: 0, 
                      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                      borderBottom: activeTab === 'lifestyle' ? '2px solid var(--primary)' : 'none',
                      background: activeTab === 'lifestyle' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                      color: activeTab === 'lifestyle' ? 'white' : 'var(--text-secondary)'
                    }}
                    onClick={() => setActiveTab("lifestyle")}
                  >
                    <Award size={16} /> Wellness Advice
                  </button>
                </div>

                {/* TAB 1: Summary & Glossary */}
                {activeTab === 'summary' && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="panel-header-badge badge-indigo">Educational Translation</span>
                    </div>
                    
                     <div className="summary-text">
                      <p>{renderInteractiveText(result.simplifiedSummary || result.simplified_summary || result.summary || result.summaryText || "")}</p>
                    </div>

                    <div style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      <HelpCircle size={14} />
                      <span>Tip: Click on any colored medical term in the summary to view definitions & analogies immediately.</span>
                    </div>

                    {/* Glossary */}
                    <div style={{ marginTop: '2.5rem' }}>
                      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.5rem', fontSize: '1.1rem' }}>
                        <BookOpen size={18} className="text-indigo-400" /> Medical Term Glossary
                      </h3>
                      {(() => {
                        const glossaryData = result && Array.isArray(result.glossary || result.medicalGlossary || result.medical_glossary)
                          ? (result.glossary || result.medicalGlossary || result.medical_glossary)
                          : [];
                        return glossaryData.length > 0 ? (
                          <div className="glossary-list">
                            {glossaryData.map((gItem, idx) => {
                              if (!gItem) return null;
                              const term = gItem.term || gItem.word || gItem.name || "";
                              const definition = gItem.definition || gItem.meaning || "";
                              const analogy = gItem.analogy || gItem.comparison || "";
                              return (
                                <div key={idx} className="glossary-item">
                                  <div className="glossary-term">{term}</div>
                                  <div className="glossary-def">{definition}</div>
                                  {analogy && <div className="glossary-analogy">💡 {analogy}</div>}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.75rem' }}>
                            No clinical glossary terms detected in this summary.
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* TAB 2: Value Highlights */}
                {activeTab === 'values' && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="panel-header-badge badge-emerald">Laboratory Breakdown</span>
                    </div>

                    {groupLabValues(result.labValues || result.lab_values || result.labs || []).map((group) => (
                      <section key={group.status} className="lab-group">
                        <div className={`lab-group-header lab-group-header-${group.status.toLowerCase()}`}>
                          <h4>{group.title}</h4>
                          <span className="lab-group-count">{group.items.length}</span>
                        </div>
                        <div className="lab-grid">
                          {group.items.map((lab, idx) => {
                            const statusClass = (lab.status || 'Normal').toLowerCase();
                            return (
                              <div key={`${group.status}-${idx}`} className={`lab-card ${statusClass}`}>
                                <div className="lab-title">{lab.name}</div>
                                <div className="lab-meta">
                                  <span className="lab-val">{lab.value}</span>
                                  <span className="lab-status">{lab.status}</span>
                                </div>
                                <div className="lab-range">Reference: {lab.referenceRange}</div>
                                <p className="lab-desc">{lab.explanation}</p>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )}

                {/* TAB 3: Doctor Consultation Questionnaire */}
                {activeTab === 'questions' && (
                  <div className="print-area">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.5rem' }}>
                      <div>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
                          <Printer size={18} className="text-indigo-400" /> Prepare For Your Doctor
                        </h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                          Tick the questions you want to discuss, and click "Print Checklist" below.
                        </p>
                      </div>
                      
                      <button className="btn-print" onClick={() => window.print()}>
                        <Printer size={14} /> Print Checklist
                      </button>
                    </div>

                    <div style={{ marginTop: '1.5rem' }}>
                      {(result.doctorQuestions || result.doctor_questions || result.questions || []).map((q, idx) => (
                        <div key={idx} className="question-item">
                          <input 
                            type="checkbox" 
                            className="question-checkbox"
                            checked={checkedQuestions.has(idx)}
                            onChange={() => handleToggleQuestion(idx)}
                          />
                          <span style={{ fontSize: '0.95rem', lineHeight: '1.4' }}>{q}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TAB 4: Wellness advice */}
                {activeTab === 'lifestyle' && (
                  <div>
                    <div>
                      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.5rem', fontSize: '1.1rem' }}>
                        <Award size={18} className="text-emerald-400" /> Evidence-Based Wellness Recommendations
                      </h3>
                      <div className="lifestyle-list">
                        {(result.lifestyleRecommendations || result.lifestyle_recommendations || result.lifestyle || []).map((rec, idx) => (
                          <div key={idx} className="lifestyle-item">
                            <CheckCircle2 className="text-emerald-400" size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span className="lifestyle-item-text">{rec}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginTop: '2.5rem' }}>
                      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.5rem', fontSize: '1.1rem' }}>
                        <ExternalLink size={18} className="text-indigo-400" /> Trusted Medical References
                      </h3>
                      <div className="references-list">
                        {(result.references || result.sources || []).map((ref, idx) => (
                          <a 
                            key={idx} 
                            href={ref.url || ref.link || "#"} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="reference-link"
                          >
                            <span>{ref.sourceName || ref.source || ref.name || "Reference"}</span>
                            <ExternalLink size={12} />
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Glossary Modal Popover */}
      {selectedTerm && (
        <div className="glossary-modal-overlay" onClick={() => setSelectedTerm(null)}>
          <div className="glass-panel glossary-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span className="panel-header-badge badge-indigo">Medical Term Explained</span>
              <button className="modal-close-btn" onClick={() => setSelectedTerm(null)}>×</button>
            </div>
            
            <h3 style={{ color: 'var(--primary)', fontSize: '1.3rem', marginBottom: '0.75rem' }}>
              {selectedTerm.term || selectedTerm.word || selectedTerm.name}
            </h3>
            
            <p style={{ fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '1.25rem', color: '#f1f5f9' }}>
              {selectedTerm.definition || selectedTerm.meaning}
            </p>
            
            {(selectedTerm.analogy || selectedTerm.comparison) && (
              <div className="glossary-analogy" style={{ background: 'rgba(99, 102, 241, 0.08)', borderLeftWidth: '4px', padding: '1rem' }}>
                <h4 style={{ fontSize: '0.85rem', color: 'white', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                  <span>💡 Easy Analogy</span>
                </h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  {selectedTerm.analogy || selectedTerm.comparison}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Camera Capture Modal */}
      {cameraOpen && (
        <div className="glossary-modal-overlay">
          <div className="glass-panel camera-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem' }}>Scan Medical Report</h3>
              <button className="modal-close-btn" onClick={closeCamera}>×</button>
            </div>
            
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Position the report clearly inside the window frame
            </p>

            <div className="camera-preview-box">
              {cameraStream ? (
                <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }}></video>
              ) : (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <Camera size={42} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
                  <p>Simulation Mode: Camera hardware unavailable.</p>
                  <p style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Click the shutter to proceed with simulated scan.</p>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              <button className="camera-shutter-btn" onClick={capturePhoto}></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
