// T-Cut para CorelDRAW 2025: exporta apenas os objetos selecionados em SVG.
// Execute em Janela > Janelas de encaixe > Scripts.
(function () {
  try {
    var doc = host.ActiveDocument;
    if (!doc || doc.SelectionRange.Count < 1) {
      alert('T-Cut: selecione as letras ou peças antes de enviar.');
      return;
    }
    var tools = host.CorelScriptTools();
    var folder = tools.GetTempFolder();
    var file = folder.replace(/[\\/]$/, '') + '\\tcut-corel-input.svg';
    try { tools.Kill(file); } catch (ignored) {}
    doc.Export(file, 1345, 2);
    alert('Seleção enviada. Abra o T-Cut local e clique em "Receber do Corel".');
  } catch (error) {
    alert('T-Cut: falha ao exportar a seleção. ' + error);
  }
})();
