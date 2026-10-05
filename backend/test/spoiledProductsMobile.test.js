const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, mountScreen, settle, translation } = require('./mobileScreenHarness');

test('Spoiled Products sends the chosen date and vegetable filters, together or apart, and resets to all records', async () => {
  const reads = [];
  const api = { get: async (path) => {
    reads.push(path);
    return { this_week: { from: '2026-09-28', to: '2026-10-04', kg: 3 }, vegetables: ['Squash', 'Tomato'], total_kg: 0, records: [] };
  } };
  const screen = mountScreen('screens/SpoiledProductsScreen.js', {
    '../api/client': { __esModule: true, default: api },
    '../hooks/useLatestRequest': { __esModule: true, default: () => () => () => true },
    '../lib/reportPeriods': loadModule('lib/reportPeriods.js', {}),
    '../lib/vegetableNames': { localizeVegetableName: (name) => name },
    '../lib/ui': { showAlert() {} },
    '../lib/errorMessages': { friendlyError: (err) => err.message },
    '../i18n/useTranslation': translation,
  }, { navigation: { goBack() {} } });
  const select = (label) => screen.findAll((props) => props.label === label)[0].props;
  const dateFields = () => screen.findAll((props) => 'minDate' in props || (props.value !== undefined && props.onChange && !props.label && !props.options));
  const step = async (fn) => { fn(); screen.render(); await settle(); screen.render(); };
  await settle(); screen.render();

  assert.deepEqual([...reads], ['/api/distributor/spoilage'], 'all records at first');
  assert.deepEqual([...select('reports.dateRange').options.map((o) => o.value)], ['all', 'week', 'month', 'year', 'custom']);
  assert.deepEqual([...select('reports.vegetable').options.map((o) => o.label)], ['reports.allVegetables', 'Squash', 'Tomato']);
  assert.doesNotMatch(screen.text(), /spoilage\.showAll/, 'nothing to reset yet');

  await step(() => select('reports.vegetable').onChange('Tomato'));
  assert.equal(reads.at(-1), '/api/distributor/spoilage?vegetable=Tomato');
  assert.match(screen.text(), /spoilage\.showAll/);

  await step(() => select('reports.dateRange').onChange('month'));
  assert.match(reads.at(-1), /^\/api\/distributor\/spoilage\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}&vegetable=Tomato$/);

  // Custom range: nothing is requested until both days are valid and in order.
  const before = reads.length;
  await step(() => select('reports.dateRange').onChange('custom'));
  assert.equal(reads.length, before, 'choosing Custom alone sends nothing');
  assert.match(screen.text(), /reports\.pickDates/);
  const [from, to] = dateFields();
  await step(() => from.props.onChange('2026-09-30'));
  await step(() => dateFields()[1].props.onChange('2026-09-01'));
  assert.equal(reads.length, before, 'an end before the start is not sent');
  assert.match(screen.text(), /reports\.startAfterEnd/);
  await step(() => dateFields()[1].props.onChange('2026-10-02'));
  assert.equal(reads.at(-1), '/api/distributor/spoilage?from=2026-09-30&to=2026-10-02&vegetable=Tomato');

  // Back to all records in one tap.
  const reset = screen.findAll((props) => typeof props.onPress === 'function' && JSON.stringify(props.children || '').includes('spoilage.showAll'))[0];
  await step(() => reset.props.onPress());
  assert.equal(reads.at(-1), '/api/distributor/spoilage');
  assert.equal(select('reports.dateRange').value, 'all');
  assert.equal(select('reports.vegetable').value, '');
  assert.ok(to, 'two date fields were shown');
});
