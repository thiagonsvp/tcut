using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;
using Cdr = Corel.Interop.VGCore;

namespace TCutDocker
{
    // WPF UserControl hosted by CorelDRAW's wpfhost docker.
    public sealed class TCutPanel : UserControl
    {
        private const string LocalUrl = "http://127.0.0.1:4173/?docker=1&ledImport=1";
        private static Process ownedServer;
        private static bool exitHookInstalled;
        private readonly TextBlock status;
        private readonly WebView2 web;
        private readonly DispatcherTimer readyTimer;
        private readonly Cdr.Application corelApplication;
        private Cdr.Document sourceDocument;
        private Cdr.ShapeRange sourceShapes;
        // Geometric bounding box (x, bottom y, width, height in document units)
        // of the selection sent to T-Cut, captured when it was sent.
        private double[] sourceBox;
        private bool messageHookInstalled;
        private int readyAttempts;

        // CorelDRAW's wpfhost passes its in-process Application to the control.
        public TCutPanel(object application)
        {
            corelApplication = application as Cdr.Application;
            var root = new Grid { Background = new SolidColorBrush(Color.FromRgb(244, 247, 243)) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            var bar = new StackPanel { Background = new SolidColorBrush(Color.FromRgb(20, 38, 30)), Margin = new Thickness(0) };
            var title = new TextBlock {
                Text = "T-CUT  |  NESTING + LETRA CAIXA + LED",
                FontSize = 13, FontWeight = FontWeights.Bold,
                Foreground = Brushes.White, Margin = new Thickness(11, 10, 8, 6)
            };
            bar.Children.Add(title);
            var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(8, 0, 8, 6) };
            var reload = MakeButton("Recarregar", Reload);
            actions.Children.Add(reload);
            bar.Children.Add(actions);
            status = new TextBlock {
                Text = "Iniciando T-Cut local...",
                FontSize = 10, TextWrapping = TextWrapping.Wrap,
                Foreground = new SolidColorBrush(Color.FromRgb(180, 216, 188)),
                Margin = new Thickness(11, 0, 9, 9)
            };
            bar.Children.Add(status);
            Grid.SetRow(bar, 0);
            root.Children.Add(bar);

            web = new WebView2();
            web.CreationProperties = new CoreWebView2CreationProperties {
                UserDataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "T-Cut", "WebView2")
            };
            web.NavigationStarting += OnNavigationStarting;
            web.NavigationCompleted += OnNavigationCompleted;
            Grid.SetRow(web, 1);
            root.Children.Add(web);
            Content = root;

            readyTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(700) };
            readyTimer.Tick += OnReadyTick;
            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
        }

        private static Button MakeButton(string text, RoutedEventHandler handler)
        {
            var button = new Button {
                Content = text, FontSize = 10, Padding = new Thickness(7, 4, 7, 4),
                Margin = new Thickness(2, 0, 2, 0), MinHeight = 28
            };
            button.Click += handler;
            return button;
        }

        private void SetStatus(string message) { status.Text = message; }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            if (IsServerReady()) { Navigate(); return; }
            StartServer();
            readyAttempts = 0;
            readyTimer.Start();
        }

        private void OnUnloaded(object sender, RoutedEventArgs e) { readyTimer.Stop(); }

        private void OnReadyTick(object sender, EventArgs e)
        {
            if (!IsServerReady()) {
                if (++readyAttempts >= 25) {
                    readyTimer.Stop();
                    SetStatus("Servidor local não respondeu. Verifique Node.js e clique em Recarregar.");
                }
                return;
            }
            readyTimer.Stop();
            Navigate();
        }

        private void Navigate()
        {
            if (web.Source == null || web.Source.ToString() != LocalUrl) web.Source = new Uri(LocalUrl);
            SetStatus("Selecione as peças no desenho e clique em Usar seleção do Corel.");
        }

        private void Reload(object sender, RoutedEventArgs e)
        {
            sourceDocument = null;
            sourceShapes = null;
            if (IsServerReady()) {
                web.Reload();
                SetStatus("Área de trabalho recarregada.");
            } else {
                StartServer();
                readyAttempts = 0;
                readyTimer.Start();
                SetStatus("Aguardando o servidor local...");
            }
        }

        private static bool IsServerReady()
        {
            try {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4173/api/corel/ping");
                request.Timeout = 350;
                request.Proxy = null;
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream()))
                    return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd() == "tcut-corel-bridge-v1";
            } catch { return false; }
        }

        private void StartServer()
        {
            if (ownedServer != null && !ownedServer.HasExited) return;
            try {
                var addonDir = Path.GetDirectoryName(GetType().Assembly.Location);
                var pathFile = Path.Combine(addonDir, "project-path.txt");
                var projectRoot = File.Exists(pathFile) ? File.ReadAllText(pathFile).Trim() : null;
                if (String.IsNullOrWhiteSpace(projectRoot)) {
                    var hostVersion = FileVersionInfo.GetVersionInfo(Process.GetCurrentProcess().MainModule.FileName).FileMajorPart;
                    using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\T-Cut\" + hostVersion))
                        projectRoot = key == null ? null : key.GetValue("InstallPath") as string;
                }
                if (String.IsNullOrWhiteSpace(projectRoot))
                    throw new InvalidOperationException("Pasta do T-Cut não encontrada. Reinstale o painel.");
                var script = Path.Combine(projectRoot, "server.js");
                if (!File.Exists(script)) throw new FileNotFoundException("server.js não encontrado", script);
                var node = Path.Combine(projectRoot, "runtime", "node.exe");
                if (!File.Exists(node)) node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
                if (!File.Exists(node)) node = "node.exe";
                var start = new ProcessStartInfo {
                    FileName = node, Arguments = "\"" + script + "\"",
                    WorkingDirectory = projectRoot, UseShellExecute = false,
                    CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
                };
                ownedServer = Process.Start(start);
                if (!exitHookInstalled) {
                    AppDomain.CurrentDomain.ProcessExit += delegate { StopOwnedServer(); };
                    exitHookInstalled = true;
                }
                SetStatus("Iniciando o servidor T-Cut...");
            } catch (Exception ex) { SetStatus("Não foi possível iniciar o servidor: " + ex.Message); }
        }

        private static void StopOwnedServer()
        {
            try { if (ownedServer != null && !ownedServer.HasExited) ownedServer.Kill(); }
            catch { }
        }

        private Cdr.Application CorelApp()
        {
            if (corelApplication == null)
                throw new InvalidOperationException("O CorelDRAW não forneceu a aplicação ao painel.");
            return corelApplication;
        }

        private void SendSelection()
        {
            if (web.CoreWebView2 == null) {
                SetStatus("Aguarde o T-Cut carregar.");
                return;
            }
            try {
                Cdr.Document doc = CorelApp().ActiveDocument;
                if (doc == null || doc.SelectionRange.Count < 1) {
                    SetStatus("Selecione as letras ou peças no CorelDRAW.");
                    return;
                }
                Cdr.ShapeRange selected = doc.SelectionRange;
                Cdr.ShapeRange captured = CorelApp().CreateShapeRange();
                for (int i = 1; i <= selected.Count; i++) captured.Add(selected[i]);
                var file = Path.Combine(Path.GetTempPath(), "tcut-corel-input.svg");
                if (File.Exists(file)) File.Delete(file);
                doc.Export(file, Cdr.cdrFilter.cdrSVG, Cdr.cdrExportRange.cdrSelection);
                sourceDocument = doc;
                sourceShapes = captured;
                double bx, by, bw, bh;
                captured.GetBoundingBox(out bx, out by, out bw, out bh, false);
                sourceBox = new[] { bx, by, bw, bh };
                Log("Seleção enviada: " + captured.Count + " objeto(s), caixa " + Format(sourceBox) + " (unidade " + doc.Unit + ")");
                SetStatus("Seleção enviada. Preparando o plano no T-Cut...");
                web.CoreWebView2.ExecuteScriptAsync(
                    "if(window.TCutCorelBridge){window.TCutCorelBridge.receiveCurrent()}" +
                    "else{chrome.webview.postMessage('TCUT_NOT_READY')}");
            } catch (Exception ex) { SetStatus("Falha ao enviar a seleção: " + ex.Message); }
        }

        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (!e.Uri.StartsWith("http://127.0.0.1:4173/", StringComparison.OrdinalIgnoreCase))
                e.Cancel = true;
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess) {
                SetStatus("Falha ao abrir o T-Cut local. Clique em Recarregar.");
                return;
            }
            if (web.CoreWebView2 != null && !messageHookInstalled) {
                web.CoreWebView2.WebMessageReceived += OnWebMessage;
                messageHookInstalled = true;
            }
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!e.Source.StartsWith("http://127.0.0.1:4173/", StringComparison.OrdinalIgnoreCase)) return;
            var message = e.TryGetWebMessageAsString();
            if (message == "TCUT_NOT_READY") {
                SetStatus("Aguarde a área de trabalho carregar e tente novamente.");
                return;
            }
            if (message == "TCUT_SEND") {
                SendSelection();
                return;
            }
            if (message == "TCUT_CLEAR_SOURCE") {
                sourceDocument = null;
                sourceShapes = null;
                sourceBox = null;
                Log("Seleção de origem limpa pelo botão Resetar.");
                return;
            }
            Log("Comando recebido: " + message);
            bool replaceSource = message == "TCUT_APPLY_NESTING";
            bool ledImport = message == "TCUT_IMPORT_LED";
            if (!replaceSource && message != "TCUT_IMPORT_LETTERBOX" && !ledImport) return;
            try {
                var file = Path.Combine(Path.GetTempPath(), "tcut-corel-output.svg");
                if (!File.Exists(file)) throw new FileNotFoundException("SVG não encontrado");
                if ((replaceSource || ledImport) && (sourceDocument == null || sourceShapes == null || sourceShapes.Count == 0))
                    throw new InvalidOperationException("Envie novamente a seleção do Corel antes de aplicar.");
                if (replaceSource && !sourceDocument.Active)
                    throw new InvalidOperationException("Ative o documento original antes de aplicar o plano.");
                // The LED result replaces the selected originals: each imported
                // group holds the original piece and its channel.
                Cdr.Document doc = (replaceSource || ledImport) ? sourceDocument : CorelApp().ActiveDocument;
                if (doc == null) throw new InvalidOperationException("Abra um documento no CorelDRAW");
                bool imported = false;
                bool completed = false;
                doc.BeginCommandGroup(replaceSource ? "T-Cut - reorganizar peças" : (ledImport ? "T-Cut - canal LED" : "T-Cut - tiras de letra caixa"));
                string ledNote = null;
                try {
                    Cdr.Layer layer = doc.ActiveLayer;
                    int beforeCount = layer.Shapes.Count;
                    var beforeIds = new HashSet<int>();
                    for (int i = 1; i <= beforeCount; i++) beforeIds.Add(layer.Shapes[i].StaticID);
                    if (ledImport) {
                        imported = true;
                        ledNote = PlaceLed(doc, layer, beforeIds, File.ReadAllText(file));
                    } else {
                        layer.Import(file, Cdr.cdrFilter.cdrSVG);
                        imported = true;
                        if (layer.Shapes.Count <= beforeCount)
                            throw new InvalidOperationException("O SVG não criou objetos no CorelDRAW.");
                    }
                    if (replaceSource || ledImport) sourceShapes.Delete();
                    completed = true;
                } finally {
                    doc.EndCommandGroup();
                    if (imported && !completed) doc.Undo();
                }
                if (replaceSource || ledImport) {
                    sourceDocument = null;
                    sourceShapes = null;
                    sourceBox = null;
                }
                if (ledImport) Log("Resultado LED: " + (ledNote ?? "alinhado"));
                SetStatus(replaceSource
                    ? "Peças reorganizadas. Confira a escala, as cores e os contornos. Ctrl+Z desfaz tudo."
                    : (ledImport
                        ? (ledNote ?? "Peças substituídas pelo resultado do T-Cut: cada grupo tem a peça e o canal LED. Ctrl+Z desfaz tudo.")
                        : "Tiras importadas. Confira a escala, as cores e os contornos. Ctrl+Z desfaz tudo."));
            } catch (Exception ex) {
                Log("Falha ao importar: " + ex);
                SetStatus("Falha ao importar: " + ex.Message);
            }
        }

        // Top-level shapes on the layer that did not exist before the import.
        private Cdr.ShapeRange NewShapes(Cdr.Layer layer, HashSet<int> beforeIds)
        {
            Cdr.ShapeRange added = CorelApp().CreateShapeRange();
            for (int i = 1; i <= layer.Shapes.Count; i++)
                if (!beforeIds.Contains(layer.Shapes[i].StaticID)) added.Add(layer.Shapes[i]);
            return added;
        }

        // CorelDRAW ignores every way of moving freshly imported SVG shapes
        // (Move, SetPositionEx, LeftX/TopY, selection), and places an SVG with
        // its canvas centred on the page. So the panel rewrites the SVG canvas
        // so that the content lands on the selected pieces, imports it, checks
        // the result and, if needed, re-imports once more with the residual.
        private string PlaceLed(Cdr.Document doc, Cdr.Layer layer, HashSet<int> beforeIds, string svg)
        {
            int expected;
            if (!Int32.TryParse(SvgAttribute(svg, "data-pieces"), NumberStyles.Integer, CultureInfo.InvariantCulture, out expected)) expected = 0;
            double[] reference = SvgBox(svg, "data-ref-bbox");
            double[] content = SvgBox(svg, "data-content-bbox") ?? SvgBox(svg, "data-led-bbox");
            double[] frame = SvgBox(svg, "viewBox");
            Log("LED: peças esperadas " + expected + ", ref " + SvgAttribute(svg, "data-ref-bbox") + ", conteúdo " + SvgAttribute(svg, "data-content-bbox") + ", quadro " + SvgAttribute(svg, "viewBox"));
            if (reference == null || content == null || frame == null || reference[2] <= 0 || reference[3] <= 0)
                throw new InvalidOperationException("O SVG do LED não tem dados de posição. Gere o canal novamente.");
            if (sourceBox == null || sourceDocument == null)
                throw new InvalidOperationException("A seleção de origem não está disponível. Clique em Usar seleção do Corel e aplique de novo.");
            if (!ReferenceEquals(sourceDocument, doc) && sourceDocument.FullFileName != doc.FullFileName)
                throw new InvalidOperationException("Aplique o LED no mesmo documento da seleção de origem.");
            double sx = sourceBox[0], sy = sourceBox[1], sw = sourceBox[2], sh = sourceBox[3];
            // Prefer the pieces' current position, in case they were moved after sending.
            try {
                if (sourceShapes != null && sourceShapes.Count > 0)
                    sourceShapes.GetBoundingBox(out sx, out sy, out sw, out sh, false);
            } catch { sx = sourceBox[0]; sy = sourceBox[1]; sw = sourceBox[2]; sh = sourceBox[3]; }
            if (sw <= 0 || sh <= 0) throw new InvalidOperationException("A seleção de origem não tem tamanho válido.");

            // Document units per SVG millimetre. Corel Y grows upwards, SVG Y
            // downwards; GetBoundingBox returns the lower-left corner.
            double kx = sw / reference[2], ky = sh / reference[3];
            double left = sx + (content[0] - reference[0]) * kx;
            double top = sy + sh - (content[1] - reference[1]) * ky;
            Cdr.Page page = layer.Page;
            double pcx = page.CenterX, pcy = page.CenterY;
            // SVG point that must land on the page centre.
            double cx = reference[0] + (pcx - sx) / kx;
            double cy = reference[1] + (sy + sh - pcy) / ky;
            double tolerance = 1e-3 * Math.Max(sw, sh) + 1e-6;
            Log("LED: origem " + Format(new[] { sx, sy, sw, sh }) + ", centro da página " + Format(new[] { pcx, pcy })
                + ", destino esquerda/topo " + Format(new[] { left, top }));

            var placed = Path.Combine(Path.GetTempPath(), "tcut-corel-output-placed.svg");
            for (int attempt = 1; attempt <= 3; attempt++) {
                double halfW, halfH;
                File.WriteAllText(placed, CenterSvgCanvas(svg, frame, cx, cy, out halfW, out halfH), new UTF8Encoding(false));
                layer.Import(placed, Cdr.cdrFilter.cdrSVG);
                Cdr.ShapeRange added = UnwrapImport(layer, beforeIds, expected + 1);
                RemoveAnchors(added, 2 * halfW * kx, 2 * halfH * ky);
                added = NewShapes(layer, beforeIds);
                if (added.Count == 0) throw new InvalidOperationException("A importação do LED ficou vazia.");
                double[] box = GeometryBox(added);
                double ex = left - box[0], ey = top - (box[1] + box[3]);
                Log("LED: tentativa " + attempt + ", importado " + Format(box) + ", diferença " + Format(new[] { ex, ey }));
                if (Math.Abs(ex) <= tolerance && Math.Abs(ey) <= tolerance) {
                    Log("LED: " + Unlock(added) + " objeto(s) desbloqueado(s).");
                    return null;
                }
                if (attempt == 3) break;
                // Move the content by the residual: shifting the canvas centre
                // the opposite way moves the content relative to the page.
                added.Delete();
                cx -= ex / kx;
                cy += ey / ky;
            }
            throw new InvalidOperationException("O CorelDRAW não colocou o canal LED na posição das peças. Nada foi alterado.");
        }

        // The SVG import arrives locked; unlock every imported shape, including
        // the shapes inside each group, so the result can be edited and moved.
        private static int Unlock(Cdr.ShapeRange range)
        {
            int count = 0;
            for (int i = 1; i <= range.Count; i++) count += Unlock(range[i]);
            return count;
        }

        private static int Unlock(Cdr.Shape shape)
        {
            int count = 0;
            if (shape.Locked) { shape.Locked = false; count++; }
            if (shape.Type == Cdr.cdrShapeType.cdrGroupShape)
                for (int i = 1; i <= shape.Shapes.Count; i++) count += Unlock(shape.Shapes[i]);
            return count;
        }

        // Imports leave one wrapper group; ungroup it so each piece's group is
        // a top-level object. UngroupEx can return an empty range here, so the
        // new shapes are collected from the layer again after ungrouping.
        private Cdr.ShapeRange UnwrapImport(Cdr.Layer layer, HashSet<int> beforeIds, int expected)
        {
            Cdr.ShapeRange added = NewShapes(layer, beforeIds);
            if (added.Count == 0) throw new InvalidOperationException("O SVG não criou objetos no CorelDRAW.");
            while (added.Count == 1 && added[1].Type == Cdr.cdrShapeType.cdrGroupShape) {
                Cdr.Shape only = added[1];
                bool wrapper = expected > 1
                    || (only.Shapes.Count == 1 && only.Shapes[1].Type == Cdr.cdrShapeType.cdrGroupShape);
                if (!wrapper) break;
                only.Ungroup();
                added = NewShapes(layer, beforeIds);
            }
            if (added.Count == 0) throw new InvalidOperationException("Os objetos importados se perderam ao desagrupar.");
            return added;
        }

        // The anchors group spans the whole canvas; it is the import object as
        // wide and tall as the canvas. Delete it once the import is placed.
        private void RemoveAnchors(Cdr.ShapeRange added, double width, double height)
        {
            for (int i = added.Count; i >= 1; i--) {
                double x, y, w, h;
                added[i].GetBoundingBox(out x, out y, out w, out h, false);
                double[] box = { x, y, w, h };
                if (box[2] >= 0.98 * width && box[3] >= 0.98 * height) {
                    Log("LED: âncoras removidas " + Format(box));
                    added[i].Delete();
                    return;
                }
            }
            Log("LED: âncoras não encontradas na importação.");
        }

        // Same content and scale (1 unit = 1 mm), with a canvas centred on (cx, cy)
        // that still contains the original frame. Two tiny anchors at opposite
        // corners make the content's bounding box equal to the canvas, so the
        // result is the same whether CorelDRAW centres the canvas or the content.
        private static string CenterSvgCanvas(string svg, double[] frame, double cx, double cy, out double halfW, out double halfH)
        {
            halfW = Math.Max(Math.Max(cx - frame[0], frame[0] + frame[2] - cx), 1);
            halfH = Math.Max(Math.Max(cy - frame[1], frame[1] + frame[3] - cy), 1);
            Func<double, string> n = v => v.ToString("0.####", CultureInfo.InvariantCulture);
            var root = Regex.Match(svg, "<svg\\b[^>]*>");
            if (!root.Success) throw new InvalidOperationException("SVG do LED inválido.");
            string tag = root.Value;
            tag = Regex.Replace(tag, "\\swidth=\"[^\"]*\"", " width=\"" + n(2 * halfW) + "mm\"");
            tag = Regex.Replace(tag, "\\sheight=\"[^\"]*\"", " height=\"" + n(2 * halfH) + "mm\"");
            tag = Regex.Replace(tag, "\\sviewBox=\"[^\"]*\"", " viewBox=\"" + n(cx - halfW) + " " + n(cy - halfH) + " " + n(2 * halfW) + " " + n(2 * halfH) + "\"");
            string anchors = "<g id=\"tcut_ancoras\" fill=\"#FFFFFF\" stroke=\"none\">"
                + "<rect x=\"" + n(cx - halfW) + "\" y=\"" + n(cy - halfH) + "\" width=\"0.1\" height=\"0.1\"/>"
                + "<rect x=\"" + n(cx + halfW - 0.1) + "\" y=\"" + n(cy + halfH - 0.1) + "\" width=\"0.1\" height=\"0.1\"/></g>";
            string body = svg.Substring(root.Index + root.Length);
            int end = body.LastIndexOf("</svg>", StringComparison.Ordinal);
            if (end < 0) throw new InvalidOperationException("SVG do LED inválido.");
            return svg.Substring(0, root.Index) + tag + body.Substring(0, end) + anchors + body.Substring(end);
        }

        private static double[] GeometryBox(Cdr.ShapeRange range)
        {
            double x, y, w, h;
            range.GetBoundingBox(out x, out y, out w, out h, false);
            return new[] { x, y, w, h };
        }

        private static string Format(double[] values)
        {
            var parts = new string[values.Length];
            for (int i = 0; i < values.Length; i++) parts[i] = values[i].ToString("0.###", CultureInfo.InvariantCulture);
            return String.Join(" ", parts);
        }

        private static void Log(string text)
        {
            try {
                File.AppendAllText(Path.Combine(Path.GetTempPath(), "tcut-panel.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "  " + text + Environment.NewLine);
            } catch { }
        }

        private static string SvgAttribute(string svg, string name)
        {
            var match = Regex.Match(svg, "<svg\\b[^>]*\\s" + Regex.Escape(name) + "=\"([^\"]*)\"");
            return match.Success ? match.Groups[1].Value : null;
        }

        private static double[] SvgBox(string svg, string name)
        {
            var text = SvgAttribute(svg, name);
            if (text == null) return null;
            var parts = text.Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length != 4) return null;
            var values = new double[4];
            for (int i = 0; i < 4; i++)
                if (!Double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out values[i])) return null;
            return values;
        }
    }
}
