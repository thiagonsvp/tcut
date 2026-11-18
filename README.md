# T-Cut Nesting Studio

Aplicação local para organizar peças vetoriais em chapas de corte CNC.

## Abrir

No PowerShell, dentro desta pasta:

```powershell
& 'C:\Program Files\nodejs\node.exe' server.js
```

Abra **http://localhost:4173** no navegador. Não há instalação de pacotes nem envio dos arquivos para a internet.

## Fluxo

1. A página abre vazia, inclusive após atualizar. No CorelDRAW, converta textos em curvas, agrupe os contornos de corte e de usinagem de cada letra e exporte o desenho em SVG com dimensões físicas em milímetros. Cada grupo vira uma peça única; objetos sem grupo entram separadamente.
2. Importe o SVG, informe as medidas da chapa, a folga mínima e a margem. Você pode dar um nome à chapa, como **Chapa de ACM**, e salvar suas dimensões no navegador para selecionar novamente depois. Ative o sentido do veio para permitir somente 0° e 180°. Sem veio, escolha a precisão da busca angular (15°, 5° ou 1°).
3. Clique em **Otimizar contornos**. O programa faz um encaixe inicial rápido e procura espaços livres usando a silhueta das peças, inclusive concavidades e vazados. Navegue entre as chapas com as setas ao lado do número da chapa.
4. Exporte a chapa selecionada em SVG ou DXF para o CAM. O PDF é produzido pela opção **Salvar como PDF** na janela de impressão do navegador.

O botão **Resetar** limpa o arquivo importado, o mapa e os parâmetros atuais, preservando as chapas salvas. O arquivo `pvc 15mm 2.svg`, com cinco letras agrupadas, permanece na pasta como exemplo para importar manualmente.

## Letra caixa

Na aba **Letra caixa**, importe um SVG com contornos de corte fechados e escala física em milímetros. A prévia mostra as faces como referência e, abaixo, uma tira por contorno externo ou interno. Os padrões são 100 mm de profundidade e ACM de 3 mm, sem abas. Ajuste o comprimento máximo, a sobreposição de emenda, o intervalo das marcas em curvas e o ângulo mínimo para marcar cantos.

As tiras são calculadas sobre o comprimento **nominal do contorno da face**. A espessura do ACM é registrada no SVG para conferência, mas não aplica automaticamente desconto ou acréscimo de dobra. O SVG de saída mantém cada tira agrupada com seu corte rosa e suas marcas verdes; o DXF usa as camadas `CORTE` e `USINAGEM`. A exportação contém apenas as tiras, sem as faces da prévia.

As marcas verdes indicam posições de usinagem, não trajetórias de ferramenta com profundidade Z. Configure a fresa, a profundidade e a compensação necessária no CAM e faça uma peça de prova antes da produção. O [guia de fabricação do DIBOND da 3A Composites](https://cdn.3acompositesusa.com/downloads/DIBOND_Fabguide0725.pdf) descreve o fresamento antes da dobra e a necessidade de preservar a pele externa do painel.

## Limites importantes

- O encaixe por contornos usa uma máscara de 1 mm e acrescenta uma pequena reserva à folga. É uma busca heurística: melhora o aproveitamento, mas não garante o ótimo matemático. Confira as distâncias finais no CAM antes do corte.
- O aproveitamento é uma estimativa da área dos contornos em relação à área total das chapas utilizadas.
- O DXF contém polilinhas amostradas a aproximadamente 0,25 mm e um contorno da chapa na camada `CHAPA`; os contornos rosa e verdes ficam, respectivamente, nas camadas `CORTE` e `USINAGEM`. Confira no CAM as curvas, a escala e quais camadas serão cortadas.
- O SVG exportado contém apenas os contornos das peças, com unidades em milímetros. A folga e a margem são usadas no posicionamento e não viram trajetórias de ferramenta.
- O PDF é uma conferência visual. A geração das trajetórias, compensação da fresa e sequência de corte devem ser feitas no software CAM.

## Verificar o algoritmo

```powershell
& 'C:\Program Files\nodejs\node.exe' test-nesting.js
```

O teste executa 400 cenários determinísticos do encaixe inicial, além de verificar colisão por máscara, encaixe em concavidade, rotação e margens:

```powershell
& 'C:\Program Files\nodejs\node.exe' test-irregular.js
& 'C:\Program Files\nodejs\node.exe' test-export.js
& 'C:\Program Files\nodejs\node.exe' test-dxf.js
```
