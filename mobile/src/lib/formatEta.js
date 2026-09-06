// Route durations are seconds. Round up before splitting to avoid "1 hr 60 min".
function formatEta(seconds) {
  if (seconds == null || seconds === '' || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return null;
  const total = Math.ceil(Number(seconds) / 60);
  const hours = Math.floor(total / 60), minutes = total % 60;
  return hours ? `${hours} hr${minutes ? ` ${minutes} min` : ''}` : `${minutes} min`;
}

module.exports = { formatEta };
