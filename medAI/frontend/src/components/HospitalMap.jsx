import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// Redefine Leaflet Default Icons to bypass Vite bundling issues with CDN links
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom Icon for User's Location (Red Pin)
const userIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Custom Icon for Hospitals (Green/Blue Pin)
const hospitalIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Component to dynamically center map when location changes
function RecenterMap({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.setView(position, 14);
    }
  }, [position, map]);
  return null;
}

export default function HospitalMap({ userLocation, hospitals }) {
  const defaultPosition = userLocation || [20.5937, 78.9629]; // Default to Center of India if loading
  const centerPosition = userLocation ? [userLocation.lat, userLocation.lng] : defaultPosition;

  return (
    <div className="map-container">
      <MapContainer 
        center={centerPosition} 
        zoom={userLocation ? 14 : 5} 
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon}>
            <Popup>
              <div className="hospital-popup">
                <h4>Your Location</h4>
                <p>GPS Coordinates: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}</p>
              </div>
            </Popup>
          </Marker>
        )}

        {hospitals.map((hosp, idx) => (
          <Marker 
            key={idx} 
            position={[hosp.lat, hosp.lon]} 
            icon={hospitalIcon}
          >
            <Popup>
              <div className="hospital-popup">
                <h4>{hosp.name || "Medical Facility"}</h4>
                {hosp.distance && <p><strong>Distance:</strong> {hosp.distance.toFixed(2)} km</p>}
                {hosp.address && <p><strong>Address:</strong> {hosp.address}</p>}
                <a 
                  href={`https://www.google.com/maps/dir/?api=1&origin=${userLocation?.lat},${userLocation?.lng}&destination=${hosp.lat},${hosp.lon}`}
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  Get Navigation Directions
                </a>
              </div>
            </Popup>
          </Marker>
        ))}

        {userLocation && <RecenterMap position={[userLocation.lat, userLocation.lng]} />}
      </MapContainer>
    </div>
  );
}
