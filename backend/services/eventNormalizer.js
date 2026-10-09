const crypto = require("crypto");

const SUPPORTED_EVENT_TYPES = [
  "shipment_status",
  "gps_update",
  "route_observation",
  "weather_observation",
  "traffic_incident",
  "vehicle_fault",
  "warehouse_event",
  "supplier_event",
];

function validateCoordinates(lat, lng) {
  if (lat == null && lng == null) return true; // Optional
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

function normalizeEvent(rawEvent, options = {}) {
  const warnings = [];
  const receivedAt = new Date().toISOString();

  // 1. Determine Event Type
  // Legacy support: if it has delay_hours, treat as shipment_status
  let eventType = rawEvent.eventType || rawEvent.type;
  if (!eventType && rawEvent.delay_hours !== undefined) {
    eventType = "shipment_status";
  }
  
  if (!SUPPORTED_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Unsupported event type: ${eventType}`);
  }

  // 2. Shipment Identifier
  const shipmentId = rawEvent.shipmentId || rawEvent.shipment_id;
  if (!shipmentId || typeof shipmentId !== "string") {
    throw new Error("Missing or invalid shipmentId");
  }

  // 3. Timestamps
  let observedAt = rawEvent.observedAt || rawEvent.timestamp;
  if (!observedAt) {
    observedAt = receivedAt;
    warnings.push("Missing observedAt timestamp; defaulting to receivedAt");
  } else {
    const parsed = new Date(observedAt);
    if (isNaN(parsed.getTime())) {
      throw new Error(`Invalid observedAt timestamp: ${observedAt}`);
    }
    observedAt = parsed.toISOString();
  }

  // 4. Location Coordinates
  let location = null;
  const rawLoc = rawEvent.location;
  if (rawLoc) {
    // Normalize lat/lng vs latitude/longitude
    const lat = rawLoc.latitude !== undefined ? rawLoc.latitude : rawLoc.lat;
    const lng = rawLoc.longitude !== undefined ? rawLoc.longitude : rawLoc.lng;
    
    if (lat !== undefined || lng !== undefined) {
      if (validateCoordinates(lat, lng)) {
        location = {
          latitude: lat,
          longitude: lng,
          label: rawLoc.label || null
        };
      } else {
        warnings.push("Invalid coordinate ranges or types; omitting location");
      }
    }
  }

  // 5. Source and Provenance
  const isSimulated = options.source === "scripted" || options.source === "manual" || rawEvent.simulated;
  
  const source = {
    provider: options.provider || "internal_system",
    deviceId: rawEvent.deviceId || null,
  };

  const provenance = {
    kind: isSimulated ? "simulated" : "verified",
    reference: options.reference || null,
  };

  // 6. Payload formatting (preserve legacy fields in payload)
  const payload = {
    ...rawEvent,
    // Remove fields that are hoisted to the root level to avoid duplication
    shipment_id: undefined,
    shipmentId: undefined,
    location: undefined,
    type: undefined,
    eventType: undefined,
    timestamp: undefined,
    observedAt: undefined
  };

  // Clean up undefined properties from payload
  Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

  const normalized = {
    eventId: rawEvent.eventId || crypto.randomUUID(),
    shipmentId,
    eventType,
    source,
    observedAt,
    receivedAt,
    location,
    payload,
    units: rawEvent.units || "metric",
    provenance,
    validation: {
      status: warnings.length === 0 ? "valid" : "warning",
      warnings
    }
  };

  return normalized;
}

// Helper to map normalized event back to the legacy format required by the frontend SSE listener
function toLegacySsePayload(normalizedEvent) {
  return {
    type: "delay", // The frontend listens for msg.type === "delay"
    timestamp: normalizedEvent.observedAt,
    source: normalizedEvent.provenance.kind === "simulated" ? "scripted" : "live",
    data: {
      shipment_id: normalizedEvent.shipmentId,
      ...normalizedEvent.payload,
      // Re-attach location in legacy format if it exists
      location: normalizedEvent.location ? {
        lat: normalizedEvent.location.latitude,
        lng: normalizedEvent.location.longitude,
        label: normalizedEvent.location.label
      } : undefined
    }
  };
}

module.exports = {
  SUPPORTED_EVENT_TYPES,
  normalizeEvent,
  toLegacySsePayload
};
