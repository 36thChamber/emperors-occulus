# Emperor’s Occulus — Machine Spirit

Observatório geoespacial das análises da Phytobloom: mapa interativo, TIFFs nas coordenadas reais, zoom livre, controle de opacidade e comparação temporal com divisor. A estética do cogitador usa metal escuro, latão e indicadores verdes, inspirada no conceito de Machine Spirit.

A integração atual consulta os produtos NDCI, NDVI, NDVI2, RGB e RGB com máscara no bucket privado `copel-siapesq`. Não executa análises nem avalia sucesso dos jobs.

## Mapa e interpretação

OpenStreetMap é o fundo padrão, sem chave de Google Maps. Arraste o mapa ou use a roda do mouse para navegar. Ao ampliar, a interface lê amostras do trecho visível após uma pausa de um segundo. **Enquadrar análise** centraliza o resultado; opacidade permite conferir o alinhamento com o mapa-base.

O GeoTIFF fornece origem, tamanho dos pixels e EPSG. As amostras são reprojetadas em memória para Web Mercator antes da sobreposição. Esta versão suporta EPSG:4326, EPSG:3857 e UTM/WGS84 norte e sul. A comparação calcula o recorte de cada TIFF pelas coordenadas do mapa, inclusive quando as grades diferem.

As prévias usam amostragem pontual, não médias: feições estreitas podem não aparecer até aproximar. NDCI/NDVI/NDVI2 usam escala visual fixa −1 a +1, sem classificação de risco ou concentração. RGB usa contraste dos percentis 2–98 de cada prévia; diferenças de brilho não são comparações quantitativas. NaN/NoData ficam transparentes; RGB inteiramente zero é tratado como fundo. Data do arquivo é a aquisição da imagem, não a execução do job.

Para usar Google Maps, configure `GOOGLE_MAPS_API_KEY` no ambiente local ou hospedado e habilite a Maps JavaScript API. A opção Google passa a ficar disponível na interface. A chave de mapa é destinada ao navegador: restrinja-a aos domínios da aplicação e à API necessária no Google Cloud. Google exige faturamento habilitado e pode cobrar conforme uso; a opção não é ativada sem configuração.

## Acesso local no Windows/WSL

```bash
cd /home/chamber/projects/emperors-occulus
./scripts/launch.sh
```

Abra `http://localhost:8765`. Se o Windows não encaminhar localhost para o WSL, use `http://<IP-do-WSL>:8765`; consulte o IP com `hostname -I`. O serviço systemd do usuário permanece ativo fora do terminal e reinicia após falhas. O atalho detecta localhost e o IP atual ao abrir.

Crie ou atualize o ícone executando pelo Explorador do Windows:

```text
\\wsl.localhost\Ubuntu\home\chamber\projects\emperors-occulus\INSTALL-ATALHO.cmd
```

O instalador coloca o atalho `.lnk` no Desktop real do Windows, inclusive com OneDrive, e copia o ícone/lançador para `%LOCALAPPDATA%\EmperorsOcculus`. Requer WSL com systemd. Para encerrar:

```bash
./scripts/stop.sh
```

Logs: `journalctl --user -u emperors-occulus.service`. O serviço inicia sob demanda, não é habilitado no boot. O acesso local aceita apenas loopback, IP do próprio WSL e gateway Windows, com validação de Host e token na API.

## Hospedagem privada

A versão hospedada usa um Worker ESM e acesso privado gerenciado por Sites. Nenhuma EC2 adicional é criada. O frontend, bibliotecas e APIs estão no mesmo domínio, com mapa-base externo. O domínio implantado aparece no resultado da publicação e nas informações do Site.

Segredos em Sites: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Configuração: `AWS_REGION=sa-east-1`, `S3_BUCKET=copel-siapesq`; `GOOGLE_MAPS_API_KEY` é opcional. As credenciais AWS do site pertencem a um usuário exclusivo, limitado a `ListBucket` no bucket e `GetObject` nos TIFFs. Não use credenciais administrativas. Não altere a audiência privada sem avaliar acesso aos dados e custos.

O Worker assina chamadas S3 usando SigV4; a assinatura e os segredos não chegam ao navegador. O catálogo é mantido em memória por até dez minutos; atualização explícita pode renová-lo após um minuto. Cada intervalo exige nome de TIFF válido, limita a leitura a 256 KiB e verifica a versão do arquivo pelo ETag. O navegador lê cabeçalhos de até 256 KiB e apenas as linhas necessárias, com oito consultas simultâneas.

**Custos:** a hospedagem fica fora da AWS; continuam possíveis cobranças por LIST/GET e saída de dados S3. Google Maps tem cobrança própria quando configurado. Há limites do serviço de hospedagem; não se promete custo total zero nem capacidade ilimitada. Não há polling ou processamento em EC2. OpenStreetMap conserva a atribuição, respeita o cache dos tiles e não faz pré-download de mapas.

Os TIFFs da entrega atual não têm compressão nem overviews. Qualidades de 96/128/256 linhas, até 1024 colunas, e teto de 16 MiB de linhas por prévia reduzem as transferências. Cabeçalhos, retries e tentativas canceladas são tráfego adicional; o contador da sessão registra bytes raster recebidos, não faturamento. Até 12 prévias e 16 cabeçalhos ficam em memória do navegador. Nenhum TIFF é salvo, não há service worker ou cache persistente de análises; os tiles do mapa-base seguem a política normal do provedor.

Formatos comprimidos, tiled/COG ou bandas não intercaladas ainda são recusados pelo leitor atual. COGs e miniaturas geradas pelo pipeline poderão melhorar a eficiência no futuro.

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
