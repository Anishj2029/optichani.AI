const { normalizeEvent, toLegacySsePayload } = require("./services/eventNormalizer");

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Valid delay event
  const validEvent = {
    shipment_id: "SH-001",
    leg_id: "L-1",
    delay_hours: 4,
    reason: "weather",
    location: { lat: 10, lng: 20, label: "Port" }
  };
  const normalized1 = normalizeEvent(validEvent, { source: "scripted" });
  assert(normalized1.shipmentId === "SH-001", "Preserves shipmentId");
  assert(normalized1.eventType === "shipment_status", "Defaults to shipment_status");
  assert(normalized1.location.latitude === 10, "Normalizes location lat to latitude");
  assert(normalized1.provenance.kind === "simulated", "Sets provenance to simulated for scripted source");
  assert(normalized1.validation.status === "warning", "Status is warning because observedAt was missing");
  assert(normalized1.validation.warnings[0].includes("observedAt"), "Warning describes missing timestamp");

  // 2. Missing shipment ID
  try {
    normalizeEvent({ type: "gps_update" });
    assert(false, "Should throw on missing shipmentId");
  } catch (err) {
    assert(err.message.includes("shipmentId"), "Throws on missing shipmentId");
  }

  // 3. Unsupported event type
  try {
    normalizeEvent({ shipmentId: "SH-002", eventType: "magic_portal" });
    assert(false, "Should throw on unsupported eventType");
  } catch (err) {
    assert(err.message.includes("Unsupported event type"), "Throws on unsupported event type");
  }

  // 4. Invalid coordinates
  const invalidLoc = {
    shipment_id: "SH-003",
    eventType: "gps_update",
    location: { lat: 190, lng: 0 } // invalid lat
  };
  const normalized4 = normalizeEvent(invalidLoc);
  assert(normalized4.location === null, "Omits invalid coordinates");
  assert(normalized4.validation.status === "warning", "Status is warning for invalid coordinates");

  // 5. Malformed timestamp
  try {
    normalizeEvent({ shipment_id: "SH-004", eventType: "warehouse_event", observedAt: "not-a-date" });
    assert(false, "Should throw on malformed timestamp");
  } catch (err) {
    assert(err.message.includes("Invalid observedAt timestamp"), "Throws on invalid timestamp");
  }

  // 6. Legacy formatting compatibility
  const legacyPayload = toLegacySsePayload(normalized1);
  assert(legacyPayload.type === "delay", "Legacy wrapper uses type='delay'");
  assert(legacyPayload.data.shipment_id === "SH-001", "Legacy wrapper restores shipment_id");
  assert(legacyPayload.data.delay_hours === 4, "Legacy wrapper retains payload properties");
  
  console.log(`\nTests complete: ${passed} passed, ${failed} failed`);
}

runTests();
