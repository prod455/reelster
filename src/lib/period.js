// Optional date range for an export, in the browser's local time zone.
// A period is `{ from, to }` in epoch ms; null means unbounded.

function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`invalid date: ${value}`);
  const [, year, month, day] = match.map(Number);
  return { year, month, day };
}

/** Period from two `<input type="date">` values ("YYYY-MM-DD" or ""), both days inclusive. */
export function parsePeriod(fromValue, toValue) {
  let from = null;
  let to = null;
  if (fromValue) {
    const { year, month, day } = parseDay(fromValue);
    from = new Date(year, month - 1, day).getTime();
  }
  if (toValue) {
    const { year, month, day } = parseDay(toValue);
    to = new Date(year, month - 1, day + 1).getTime() - 1;
  }
  if (from !== null && to !== null && from > to) throw new Error("start date is after the end date");
  return { from, to };
}

export function inPeriod(timestamp, { from, to }) {
  return (from === null || timestamp >= from) && (to === null || timestamp <= to);
}

/** True once a message is older than the period, so older history is not needed. */
export function isBeforePeriod(timestamp, { from }) {
  return from !== null && timestamp < from;
}
