// Update sent to the map page. The road line is left out when it is the same
// array the page already drew, so GPS updates and 5 s polls do not re-send and
// redraw a long route. `sent` is per map page; reset it when the page reloads.
function mapPayload(data, sent) {
  if (data?.route && data.route === sent.route) {
    const { route, ...rest } = data;
    return rest;
  }
  sent.route = data?.route;
  return data;
}

module.exports = { mapPayload };
