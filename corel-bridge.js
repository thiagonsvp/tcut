(() => {
  const docker = new URLSearchParams(location.search).has('docker');
  if (docker) document.body.classList.add('docker-mode');
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!local) return;

  if (!docker) document.querySelectorAll('.corel-control').forEach(button => button.classList.remove('hidden'));

  async function receive(button) {
    button.disabled = true;
    try {
      const response = await fetch('/api/corel/input', { cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      const svg = await response.text();
      const letterbox = !$('letterboxView').classList.contains('hidden');
      const target = letterbox ? window.TCutLetterboxBridge : window.TCutNestingBridge;
      await target.importSvg(svg, 'Seleção do CorelDRAW.svg');
      notify(letterbox ? 'Seleção recebida e tiras geradas.' : 'Seleção recebida e plano otimizado.');
      return true;
    } catch (error) {
      notify(error.message || 'Falha ao receber a seleção do CorelDRAW.', true);
      return false;
    } finally {
      button.disabled = false;
    }
  }

  async function send(button) {
    button.disabled = true;
    try {
      const target = button.dataset.corelSend === 'letterbox' ? window.TCutLetterboxBridge : window.TCutNestingBridge;
      const svg = target.exportSvg();
      const response = await fetch('/api/corel/output', {
        method: 'POST',
        headers: { 'Content-Type': 'image/svg+xml' },
        body: svg,
      });
      if (!response.ok) throw new Error(await response.text());
      notify('SVG pronto. No CorelDRAW, execute “T-Cut - Importar resultado”.');
      return true;
    } catch (error) {
      notify(error.message || 'Falha ao enviar o resultado ao CorelDRAW.', true);
      return false;
    } finally {
      button.disabled = false;
    }
  }

  document.querySelectorAll('[data-corel-receive]').forEach(button => button.addEventListener('click', () => receive(button)));
  document.querySelectorAll('[data-corel-send]').forEach(button => button.addEventListener('click', () => send(button)));
  window.TCutCorelBridge = {
    receiveCurrent() {
      const view = $('letterboxView').classList.contains('hidden') ? $('nestingView') : $('letterboxView');
      return receive(view.querySelector('[data-corel-receive]'));
    },
    sendCurrent() {
      const view = $('letterboxView').classList.contains('hidden') ? $('nestingView') : $('letterboxView');
      return send(view.querySelector('[data-corel-send]'));
    },
  };
})();
