const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function element(dataset = {}) {
  const classes = new Set();
  return {
    dataset, disabled: false, textContent: '',
    classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains: name => classes.has(name) },
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    querySelector() { return { textContent: '', replaceChildren() {} }; },
  };
}

async function main() {
  const receive = element();
  const send = element({ corelSend: 'nesting' });
  const letterboxSend = element({ corelSend: 'letterbox' });
  const ledSend = element({ corelSend: 'led' });
  const ids = Object.fromEntries(
    ['importButton', 'lbImportButton', 'ledImportButton', 'emptyState', 'fileName', 'fileSubtitle', 'placedDetail', 'settingsMessage', 'lbFileName', 'lbFileDetail', 'lbMessage', 'lbResultsList', 'ledFileName', 'ledFileDetail', 'ledMessage', 'ledResultsList', 'piecesList', 'resetButton', 'lbResetButton', 'ledResetButton', 'letterboxView', 'ledView', 'nestingView']
      .map(id => [id, element()])
  );
  const messages = [];
  const posts = [];
  const controls = [receive, send, letterboxSend, ledSend];
  const document = {
    body: { classList: { add() {} } },
    querySelectorAll(selector) {
      if (selector === '.corel-control') return controls;
      if (selector === '[data-corel-receive]') return [receive];
      if (selector === '[data-corel-send]') return [send, letterboxSend, ledSend];
      return [];
    },
  };
  const context = vm.createContext({
    document, location: { search: '?docker=1', hostname: '127.0.0.1' },
    URLSearchParams, $: id => ids[id],
    window: {
      chrome: { webview: { postMessage: value => messages.push(value) } },
      TCutNestingBridge: { exportSvg: () => '<svg></svg>' },
      TCutLetterboxBridge: { exportSvg: () => '<svg id="tiras"></svg>' },
      TCutLedBridge: { exportSvg: () => '<svg id="led"></svg>' },
    },
    fetch: async (url, options) => {
      posts.push({ url, options });
      return { ok: true };
    },
    notify() {},
  });
  vm.runInContext(fs.readFileSync('corel-bridge.js', 'utf8'), context);
  assert.equal(ids.importButton.classList.contains('hidden'), true);
  assert.equal(ids.lbImportButton.classList.contains('hidden'), true);
  receive.listeners.click();
  assert.deepEqual(messages, ['TCUT_SEND']);
  assert.equal(posts.length, 0, 'receber seleção não deve abrir seletor de arquivo nem chamar a API antes do Corel');
  await send.listeners.click();
  assert.equal(posts[0].url, '/api/corel/output');
  assert.equal(posts[0].options.body, '<svg></svg>');
  assert.deepEqual(messages, ['TCUT_SEND', 'TCUT_APPLY_NESTING']);
  await letterboxSend.listeners.click();
  assert.equal(posts[1].options.body, '<svg id="tiras"></svg>');
  assert.deepEqual(messages, ['TCUT_SEND', 'TCUT_APPLY_NESTING', 'TCUT_IMPORT_LETTERBOX']);
  await ledSend.listeners.click();
  assert.equal(posts[2].options.body, '<svg id="led"></svg>');
  assert.equal(messages.pop(), 'TCUT_IMPORT_LETTERBOX', 'painel instalado usa o comando aditivo disponível');
  context.location.search += '&ledImport=1';
  await ledSend.listeners.click();
  assert.deepEqual(messages, ['TCUT_SEND', 'TCUT_APPLY_NESTING', 'TCUT_IMPORT_LETTERBOX', 'TCUT_IMPORT_LED']);
  ids.resetButton.listeners.click();
  assert.deepEqual(messages, ['TCUT_SEND', 'TCUT_APPLY_NESTING', 'TCUT_IMPORT_LETTERBOX', 'TCUT_IMPORT_LED', 'TCUT_CLEAR_SOURCE']);
  console.log('Painel Corel: seleção e aplicação sem escolha manual de arquivo');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
