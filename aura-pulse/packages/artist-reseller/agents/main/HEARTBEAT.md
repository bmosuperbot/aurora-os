# Heartbeat checklist

Runs every 30 minutes during active hours. Follow strictly. Do not infer
tasks from prior chats.

- Scan inbox for new marketplace offer emails. If found, create an
  `offer-received` contract via `aura_surface_decision`.
- Check active shipping orders for status updates. If a shipment is late,
  create a `shipping-delay` contract via `aura_surface_decision`.
- Review pending contracts approaching TTL expiry. If any are close,
  create a reminder contract via `aura_surface_decision`.
- If nothing needs attention, reply HEARTBEAT_OK.
