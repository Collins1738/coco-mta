// Keep this in sync with the kiosk's walking-time display.
export const WALK_MINUTES = 10;

export function nextDeparture(arrivals, nowSeconds = Math.floor(Date.now() / 1000)) {
  const walkSeconds = WALK_MINUTES * 60;
  const train = arrivals
    .filter(a => a.type === 'subway' && a.route === 'A' && a.direction === 'N'
      && Number.isFinite(a.arrivalTime) && a.arrivalTime >= nowSeconds + walkSeconds)
    .sort((a, b) => a.arrivalTime - b.arrivalTime)[0];

  if (!train) return null;
  const leaveAt = train.arrivalTime - walkSeconds;
  return {
    route: train.route,
    station: 'Utica Av',
    direction: train.direction,
    directionLabel: train.directionLabel,
    arrivalTime: train.arrivalTime,
    leaveAt,
    leaveInMinutes: Math.max(0, Math.ceil((leaveAt - nowSeconds) / 60)),
    walkMinutes: WALK_MINUTES,
  };
}
