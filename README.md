# Emperor’s Occulus — Machine Spirit

Observatório geoespacial das análises da Phytobloom: mapa interativo, TIFFs nas coordenadas reais, zoom livre, controle de opacidade e comparação temporal com divisor. A interface usa estética de terminal CRT monocromático com fósforo verde, tipografia monoespaçada, brilho leve e scanlines estáticas. O mapa ocupa a maior parte da tela e pode ser ampliado para tela inteira. O filtro afeta somente o mapa-base; as cores dos índices e das análises permanecem originais.

O módulo Phytobloom consulta NDCI, NDVI, NDVI2, RGB e RGB com máscara no bucket privado `copel-siapesq`. O app também inclui os módulos SIAPESQ e SIAPRESP, descritos abaixo. Não executa análises nem avalia sucesso dos jobs.

## Mapa e interpretação

OpenStreetMap é o fundo padrão, sem chave de Google Maps. Arraste o mapa ou use a roda do mouse para navegar. Em **Detalhado · grade original**, a interface lê os pixels originais do trecho visível por blocos. Os modos Econômico e Equilibrado continuam disponíveis como prévias amostradas. **Enquadrar análise** centraliza o resultado; opacidade permite conferir o alinhamento com o mapa-base.

O GeoTIFF fornece origem, tamanho dos pixels e EPSG. As amostras são reprojetadas em memória para Web Mercator antes da sobreposição. Esta versão suporta EPSG:4326, EPSG:3857 e UTM/WGS84 norte e sul. A comparação calcula o recorte de cada TIFF pelas coordenadas do mapa, inclusive quando as grades diferem.

Nos modos Econômico e Equilibrado, as prévias usam amostragem pontual, não médias: feições estreitas podem não aparecer até aproximar. NDCI/NDVI/NDVI2 usam escala visual fixa −1 a +1, sem classificação de risco ou concentração. RGB usa contraste dos percentis 2–98 de cada prévia; diferenças de brilho não são comparações quantitativas. NaN/NoData ficam transparentes; RGB inteiramente zero é tratado como fundo. Data do arquivo é a aquisição da imagem, não a execução do job.

Para usar Google Maps, configure `GOOGLE_MAPS_API_KEY` no ambiente local ou hospedado e habilite a Maps JavaScript API. As opções Google ruas e Google satélite passam a ficar disponíveis na interface. Ruas usa estilos nativos em verde e preto; satélite recebe filtro visual de fósforo verde. OpenStreetMap também recebe o filtro CRT. A chave de mapa é destinada ao navegador: restrinja-a aos domínios da aplicação e à API necessária no Google Cloud. Google exige faturamento habilitado e pode cobrar conforme uso; a opção não é ativada sem configuração.

## Acesso local no Windows/WSL

```bash
cd /home/chamber/projects/emperors-occulus
./scripts/launch.sh
```

Abra `http://localhost:8765`. Se o Windows não encaminhar localhost para o WSL, use `http://<IP-do-WSL>:8765`; consulte o IP com `hostname -I`. O serviço systemd do usuário permanece ativo fora do terminal e reinicia após falhas. O atalho abre a versão hospedada por padrão. Para usar a versão local, execute `scripts/launch-windows.ps1 -Local`; nesse modo ele detecta localhost e o IP atual ao abrir.

Crie ou atualize o ícone executando pelo Explorador do Windows:

```text
\\wsl.localhost\Ubuntu\home\chamber\projects\emperors-occulus\INSTALL-ATALHO.cmd
```

O instalador coloca o atalho `.lnk` no Desktop real do Windows, inclusive com OneDrive, e copia o ícone/lançador para `%LOCALAPPDATA%\EmperorsOcculus`. Requer WSL com systemd. Para encerrar:

```bash
./scripts/stop.sh
```

Logs: `journalctl --user -u emperors-occulus.service`. O serviço inicia sob demanda, não é habilitado no boot. O acesso local aceita apenas loopback, IP do próprio WSL e gateway Windows, com validação de Host e token na API.

## Hospedagem pública

A versão hospedada usa um Worker ESM e acesso público gerenciado por Sites. Nenhuma EC2 adicional é criada. O frontend, bibliotecas e APIs estão no mesmo domínio, com mapa-base externo. URL do Site: https://emperors-occulus.copperbowl512.chatgpt.site. O acesso é livre, sem login, por solicitação do proprietário.

Segredos em Sites: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Configuração: `AWS_REGION=sa-east-1`, `S3_BUCKET=copel-siapesq`; `GOOGLE_MAPS_API_KEY` é opcional. As credenciais AWS do site pertencem a um usuário exclusivo, limitado a `ListBucket` no bucket e `GetObject` nos TIFFs. Não use credenciais administrativas. Os visitantes podem consultar as análises publicadas; o bucket permanece privado e as credenciais AWS ficam exclusivamente no servidor.

O Worker assina chamadas S3 usando SigV4; a assinatura e os segredos não chegam ao navegador. O catálogo é mantido em memória por até dez minutos; atualização explícita pode renová-lo após um minuto. Cada intervalo exige nome de TIFF válido, limita a leitura a 256 KiB e verifica a versão do arquivo pelo ETag. O navegador busca os metadados TIFF dinamicamente, com limite de 2 MiB, e lê linhas ou blocos necessários à prévia.

**Custos:** a hospedagem fica fora da AWS; continuam possíveis cobranças por LIST/GET e saída de dados S3. Google Maps tem cobrança própria quando configurado. Há limites do serviço de hospedagem; não se promete custo total zero nem capacidade ilimitada. Não há polling ou processamento em EC2. OpenStreetMap conserva a atribuição, respeita o cache dos tiles e não faz pré-download de mapas.

Os TIFFs da entrega atual não têm compressão nem overviews. Qualidades de 96/128/256 linhas, até 1024 colunas, e teto de 16 MiB de linhas por prévia reduzem as transferências. Cabeçalhos, retries e tentativas canceladas são tráfego adicional; o contador da sessão registra bytes raster recebidos, não faturamento. Até 12 prévias e 16 cabeçalhos ficam em memória do navegador. Nenhum TIFF é salvo, não há service worker ou cache persistente de análises; os tiles do mapa-base seguem a política normal do provedor.

O suporte a LZW/DEFLATE e tiles permite abrir também as predições STE e SIAPRESP. Overviews de COG e miniaturas geradas pelo pipeline poderão melhorar ainda mais a eficiência.

## Desenvolvimento

Python 3.11+ para o backend local; Node 20+ para empacotamento hospedado. Credenciais locais usam Boto3 e a cadeia padrão AWS. `AWS_PROFILE`, `AWS_REGION`, `OCCULUS_BUCKET` e `OCCULUS_PORT` podem ser configurados; para serviço systemd, configure o ambiente na unidade quando necessário. O atalho Windows usa porta 8765.

```bash
./scripts/setup.sh
npm ci
npm run build
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
npm test
```

- `occulus/app.py`: serviço local e endpoint de leituras parciais.
- `occulus/static/raster.js`: parser TIFF, amostragem e reprojeção em memória.
- `occulus/static/app.js`: Leaflet, comparação, opacidade e refinamento do recorte visível.
- `hosted/worker/api.js`: assinatura S3, catálogo e proxy de intervalos.
- `scripts/build-hosted.mjs`: gera um Worker independente em `dist/server/index.js`, incluindo os assets.
- `.openai/hosting.json`: identidade do Site, sem segredos.
- `tests/map_check.py`: QA de navegador com S3 real, somente leitura; usa AWS.
- `tests/worker.test.mjs` e `tests/test_viewer.py`: verificações com dados simulados, sem custo AWS.

Para futuras famílias de análise, adicione um provedor de catálogo/produtos e uma entrada de navegação. Phytobloom é o primeiro módulo. As bibliotecas vendorizadas mantêm suas licenças em `occulus/static/vendor/licenses/`.

O emblema é uma cruz com caveira central em fósforo verde, desenhada em SVG. Para regenerar o ícone Windows: `.venv/bin/python scripts/generate_icon.py`.

## Módulos SIAPESQ e SIAPRESP

O seletor no cabeçalho alterna entre **Phytobloom**, **SIAPESQ** e **SIAPRESP**. Cada catálogo é carregado sob demanda e mantido separadamente em memória. O acesso público inclui os rasters publicados e as tabelas de ocorrência identificadas por espécie; o app não aceita nomes arbitrários de buckets nem expõe credenciais AWS.

- **STE:** caminhos canônicos em `ste-siapesq/predictions/` e lotes em `predicoes_cenarios/`. Espécie/grupo, recorte ou lote, produto e cenário são filtros independentes. Os modelos científicos `Primatas_grupo` usam o slug `aranha`; aliases e cópias antigas não viram mapas duplicados. Há adequabilidade, incerteza, extrapolação e, nos lotes que o incluem, adequabilidade original R. Os cenários anuais, mensais e futuros permanecem identificados; SSPs distintos não são misturados. Os recortes originais são exibidos individualmente e preservam suas máscaras; a seleção Brasil de 1 km não recompõe automaticamente o interior do RS com os outros dois arquivos.
- **SIAPRESP:** produtos em `tifs-siapesq/predictions/daily/`. Espécie, data, predição média e desvio-padrão. O recorte inicial Atlântico Sul reduz o volume de leitura; é possível selecionar a extensão integral, respeitando o orçamento de transferência. A data é a data do produto, não comprovação de sucesso de uma execução. Preditores e modelos treinados não são expostos. Tabelas de ocorrência correspondentes são consultadas no catálogo do SIAPESQ, quando disponíveis.
- **Escalas:** os índices Phytobloom mantêm −1 a +1. STE e SIAPRESP usam uma escala visual explícita de 0 a 1, inclusive na visualização do desvio-padrão. Valores fora da escala são saturados apenas para exibição. O desvio-padrão continua sendo um produto separado da predição média/adequabilidade, e não é interpretado como probabilidade.

O leitor aceita rasters sem compressão, LZW e DEFLATE, incluindo faixas e tiles e preditores TIFF 2/3. Bandas separadas são aceitas para rasters de uma única banda. A leitura de diretórios TIFF é dinâmica, inclusive quando os metadados ficam no fim do arquivo, com teto de 2 MiB. Blocos comprimidos necessários às amostras são buscados e decodificados no navegador; não há download para disco. Blocos muito grandes ou recortes que excedam 16 MiB são recusados com orientação para aproximar o recorte. Em rasters comprimidos pequenos, os blocos necessários podem abranger boa parte dos dados. `sampleStats` descreve somente as amostras da prévia, nunca a população inteira do raster.

O usuário IAM exclusivo do site tem somente leitura de TIFFs dos três conjuntos de saídas e de CSVs em `ste-siapesq/species-table/`. Os buckets continuam privados. Esta integração não liga instâncias nem altera resultados existentes.

Validação adicional: `tests/test_modules.py`, testes de módulos em `tests/worker.test.mjs`, `tests/compressed_raster_check.py` (fixtures em memória, sem AWS) e `tests/modules_browser_check.py` (rasters reais, leitura de S3). O teste de decodificação compara valores float32, NoData e escalas visuais; o teste real confere STE LZW e SIAPRESP DEFLATE.


## Barra lateral e ocorrências

**Controles** recolhe ou abre a barra lateral de seleção e libera a largura para o mapa. No celular a barra fica sobre o mapa e começa oculta. O botão de tela inteira permanece disponível.

Nos módulos SIAPESQ e SIAPRESP, **Mostrar tabela** abre os registros da espécie com todas as colunas, busca e paginação de 40 linhas. **Plotar ocorrências** desenha as presenças em Canvas, em fósforo verde, com informações ao clicar; **Enquadrar pontos** centraliza seus limites. Os pontos podem ser ocultados independentemente da tabela e do raster. Trocar de espécie ou módulo remove a camada anterior. Mudar o cenário não transforma registros históricos em ocorrências futuras.

O leitor consulta somente CSVs reconhecidos em `ste-siapesq/species-table/`, pela espécie do TIFF selecionado, com aliases explícitos para os quatro grupos clássicos. São as fontes originais das cópias colocadas junto dos TIFFs. Para as demais espécies, escolhe a data mais recente no nome `Occurrence_<espécie>_<dd_mm_aa>.csv`, preferindo a versão sem sufixo de cópia. A tabela identifica o caminho consultado. A correspondência por espécie não prova que esta versão da tabela foi usada no treinamento.

Em tabelas classificadas, somente `sp=1` (ou uma coluna de presença reconhecida) entra na tabela e no mapa. Marcadores de ausência/pseudoausência prevalecem em caso de conflito. Arquivos explicitamente de ocorrência sem coluna de classe são tratados como presenças, respeitando `occurrenceStatus` quando informado. Classes desconhecidas e linhas malformadas são excluídas. Coordenadas vazias, não numéricas ou fora do intervalo geográfico não são desenhadas, mas o registro de presença continua na tabela e é contado como sem coordenada válida. Não se removem linhas apenas por compartilharem coordenadas; pontos coincidentes podem se sobrepor.

O CSV é lido somente quando solicitado, com limite de 16 MiB. Não há download permanente: até três espécies ficam em cache na memória da página por dez minutos. **Sincronizar** limpa esse cache. A API valida o caminho de um TIFF permitido, fixa o bucket e resolve a fonte no servidor; não aceita um caminho CSV arbitrário. A lista de fontes no servidor tem cache de dez minutos. Espécies sem tabela identificada mostram uma mensagem, sem substituir por outra espécie.

Verificações: `npm run build && npm test`, testes Python e `tests/occurrence_browser_check.py` (navegador local na porta 8876, usando CSVs reais do S3; catálogos de teste). `tests/occurrences_live_check.mjs` testa o Worker e o filtro com S3 real, recebendo credenciais somente por stdin.


Os lotes ativos consolidados ficam em `predicoes_cenarios/comuns-rs-es/` (26 espécies), `predicoes_cenarios/exclusivas-rs/` (4 espécies) e `predicoes_cenarios/exclusivas-es-ocean/` (4 espécies). Cada espécie tem 17 cenários; as versões históricas ficam fora do catálogo em `migration-backups/`. Os nomes dos TIFFs são preservados. O `complete.json` de cada cenário registra a origem da versão selecionada, e `_run/consolidation.json` registra a seleção do grupo. Em Turdus rufiventris, somente 3 cenários foram concluídos no retreino; os outros 14 mantêm a versão anterior, sem presumir que pertencem ao mesmo modelo.


## Resolução nativa no mapa

**Detalhado · grade original** é o padrão. O recorte `rs_250m` sempre usa esse modo, inclusive com o mapa afastado. A grade do arquivo de teste é 4.400 × 3.600 pixels, com escala de 0,0025° em EPSG:4326; 250 m é uma resolução nominal, não uma grade métrica exatamente quadrada em toda latitude.

`native-raster.js` lê faixas nativas de até 128 linhas e desenha blocos com cada célula da fonte, respeitando NoData. O leitor em `raster.js` agrupa intervalos contíguos em requisições de até 256 KiB, decodifica LZW/DEFLATE e mantém até 64 MiB de blocos decodificados em memória por camada. As faixas sem compressão são lidas por intervalos de linha. Os blocos de desenho são alinhados à grade de origem para reutilização durante a navegação. Ao sair da área visível, as imagens correspondentes são removidas; nenhum TIFF é salvo no disco.

O indicador só declara **Grade original** depois de concluir todos os blocos necessários. **Visão reduzida na tela** significa que vários pixels da grade cabem em um pixel físico do monitor; o leitor continua usando a grade nativa. **Pixels individuais na tela** informa que o zoom permite distinguir essas células. A reprojeção para o mapa usa vizinho mais próximo, com grade de desenho sem a antiga altura fixa de 512; isso não altera a matriz do TIFF. Para RGB, o contraste da primeira faixa válida fica fixo por camada para evitar mudanças entre blocos.

A leitura é limitada a 16 Mi pixels de grade no recorte visível e 64 MiB transferidos por atualização/camada. O arquivo de 250 m testado tem 15,84 milhões de pixels e cabe integralmente. Se outro arquivo exceder os limites, o indicador informa leitura incompleta e pede aproximação; não troca silenciosamente para uma prévia reduzida. Em comparação, as duas camadas mantêm leitores próprios e o mesmo divisor visual. O cancelamento ao mover ou trocar de espécie impede que uma leitura antiga complete uma seleção nova.

Os TIFFs oficiais permanecem nos caminhos originais. Um lote piloto de 45 cópias COG da SIAPESQ fica exclusivamente em `s3://ste-siapesq/auspex/cog-avaliacao/2026-10-20/ste/`, mantendo abaixo desse prefixo o caminho e nome original. No módulo SIAPESQ, **Fonte dos TIFFs → COG · avaliação** mostra somente esse lote; **Oficial · original** continua sendo o padrão. O piloto cobre as três resoluções clássicas e os três grupos de cenários, com produtos anuais, mensais e futuros, incluindo incerteza e extrapolação. Não representa a conversão dos 2.210 TIFFs do catálogo nem dos outros módulos.

`pilot-manifest.json` registra ETags e SHA-256 separados para fonte e cópia, validação COG estrita, comparação bit a bit de todos os pixels e máscaras, metadados espaciais e leitura parcial de volta do S3. As cópias usam DEFLATE sem perdas, blocos de 512 pixels e overviews por vizinho mais próximo. O modo nativo usa a imagem base; as overviews não substituem a grade obrigatória de 250 m. A API resolve apenas cópias aprovadas no manifesto e o catálogo exclui cópias cuja fonte oficial mudou de ETag. Nomes canônicos continuam resolvendo as mesmas ocorrências. O bucket permanece privado. A adoção definitiva depende da avaliação; não houve alteração nas plataformas oficiais.

QA: `tests/native_raster_check.py` compara todos os pixels em LZW, DEFLATE e TIFF sem compressão, testa cache, cancelamento e comparação. `tests/native_s3_check.py` verifica a grade completa real de 250 m sem zoom, pixels contra rasterio, navegação e layout mobile, sem guardar um TIFF local. Esses testes usam a prévia local na porta 8876. Resultados e screenshots ficam em `artifacts/native/`.
