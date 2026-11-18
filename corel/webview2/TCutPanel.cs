using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Cdr = Corel.Interop.VGCore;

namespace TCutDocker
{
    // WPF UserControl hosted by CorelDRAW's wpfhost docker.
    public sealed class TCutPanel : UserControl
    {
        private const string LocalUrl = "http://127.0.0.1:4173/?docker=1";
        private static Process ownedServer;
        private static bool exitHookInstalled;
        private readonly TextBlock status;
        private readonly WebView2 web;
        private readonly DispatcherTimer readyTimer;
        private readonly Cdr.Application corelApplication;
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
                Text = "T-CUT  |  NESTING + LETRA CAIXA",
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
                var projectRoot = File.ReadAllText(Path.Combine(addonDir, "project-path.txt")).Trim();
                var script = Path.Combine(projectRoot, "server.js");
                if (!File.Exists(script)) throw new FileNotFoundException("server.js não encontrado", script);
                var node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
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
                var file = Path.Combine(Path.GetTempPath(), "tcut-corel-input.svg");
                if (File.Exists(file)) File.Delete(file);
                doc.Export(file, Cdr.cdrFilter.cdrSVG, Cdr.cdrExportRange.cdrSelection);
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
            if (message != "TCUT_IMPORT") return;
            try {
                var file = Path.Combine(Path.GetTempPath(), "tcut-corel-output.svg");
                if (!File.Exists(file)) throw new FileNotFoundException("SVG não encontrado");
                Cdr.Document doc = CorelApp().ActiveDocument;
                if (doc == null) throw new InvalidOperationException("Abra um documento no CorelDRAW");
                doc.ActiveLayer.Import(file, Cdr.cdrFilter.cdrSVG);
                SetStatus("Resultado importado. Confira a escala, as cores e os contornos.");
            } catch (Exception ex) { SetStatus("Falha ao importar: " + ex.Message); }
        }
    }
}
