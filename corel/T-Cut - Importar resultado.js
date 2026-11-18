// T-Cut para CorelDRAW 2025: importa o SVG gerado na camada ativa.
// Execute em Janela > Janelas de encaixe > Scripts.
(function () {
  try {
    var doc = host.ActiveDocument;
    if (!doc) {
      alert('T-Cut: abra um documento antes de importar o resultado.');
      return;
    }
    var tools = host.CorelScriptTools();
    var folder = tools.GetTempFolder();
    var file = folder.replace(/[\\/]$/, '') + '\\tcut-corel-output.svg';
    doc.ActiveLayer.Import(file, 1345);
    alert('Resultado importado na camada ativa. Confira a escala e os contornos.');
  } catch (error) {
    alert('T-Cut: não foi possível importar. Envie o resultado no T-Cut local primeiro. ' + error);
  }
})();
