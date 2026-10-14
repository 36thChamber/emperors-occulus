# Emperor’s Occulus

Observatório local das análises da Phytobloom. Consulta os resultados existentes no S3, exibe prévias de NDCI, NDVI, NDVI2, RGB e RGB com máscara, compara datas e permite ampliar trechos. A primeira integração é o bucket `copel-siapesq`.

## Uso neste computador

```bash
cd /home/chamber/projects/emperors-occulus
./scripts/launch.sh
```

Abra **http://localhost:8765** no Windows. Se o encaminhamento do localhost estiver indisponível, use o IP retornado por `hostname -I` no WSL, seguido de `:8765` (por exemplo `http://192.168.170.234:8765`). O IP pode mudar quando o WSL reinicia. O atalho testa localhost e os IPs atuais antes de abrir o navegador. Selecione área, produto e data e clique em **Visualizar**. O catálogo abre sem ler imagens. Duplo clique na imagem aproxima o ponto escolhido. A comparação usa o mesmo recorte relativo nas duas datas, não um alinhamento geográfico entre arquivos de grades diferentes.

Para criar o ícone na área de trabalho do Windows, execute no **PowerShell do Windows**:

```powershell
powershell -ExecutionPolicy Bypass -File "\\wsl.localhost\Ubuntu\home\chamber\projects\emperors-occulus\scripts\install-windows.ps1"
```

O instalador cria um atalho real `.lnk`, copia o ícone para `%LOCALAPPDATA%\EmperorsOcculus` e usa um lançador oculto para iniciar o servidor no WSL e abrir o navegador. Respeita a pasta Desktop do Windows, inclusive quando redirecionada ao OneDrive. Não instala serviço Windows nem inicia na entrada do usuário. A distribuição e o caminho podem ser personalizados pelos parâmetros `-Distro` e `-ProjectPath`.

O servidor continua disponível após fechar a aba, para reutilizar prévias. Para encerrá-lo e liberar a memória:

```bash
./scripts/stop.sh
```

## Instalação em outro ambiente

Python 3.11+ e credenciais AWS locais de leitura são necessários. Instale o Python/venv no WSL, clone o repositório e execute:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
./scripts/launch.sh
```

A autenticação usa a cadeia padrão do Boto3 (`~/.aws`, AWS SSO, variáveis de ambiente ou role). Não cole credenciais na interface. Permissões necessárias: `s3:ListBucket` no bucket e `s3:GetObject` nos TIFFs. Se sua organização usar SSE-KMS, a chave também precisa permitir descriptografia. Nenhuma operação de escrita S3 é implementada.

Variáveis opcionais: `AWS_PROFILE`, `AWS_REGION` (padrão `sa-east-1`), `OCCULUS_BUCKET` (padrão `copel-siapesq`) e `OCCULUS_PORT` (padrão `8765`). O atalho instalado usa a porta padrão.

## Como evita transferências grandes

Os TIFFs atuais da Phytobloom são organizados em faixas, sem compressão, e não possuem overviews. Ler uma miniatura com ferramentas genéricas pode transferir o arquivo inteiro. Este leitor:

1. Lista nomes, tamanhos, ETags e datas, mantendo o catálogo em RAM. Uma atualização explícita faz nova listagem; há intervalo mínimo de 60 segundos entre atualizações.
2. Lê cabeçalhos TIFF por HTTP Range, com limite de 2 MiB para metadados.
3. Seleciona linhas e colunas espaçadas e consulta apenas os intervalos correspondentes às linhas do recorte. As linhas lidas são reduzidas em memória.
4. Impõe limite estimado de 16 MiB de conteúdo por prévia, incluindo metadados. Qualidades: 96, 128 ou 256 linhas; largura até 1024 amostras. Transferências já realizadas em tentativas com erro e retries de rede não entram no contador da interface.
5. Reutiliza até 24 prévias PNG em RAM. Atualizar o catálogo ou encerrar o processo descarta o cache. Dados brutos existem apenas durante a leitura. Nenhum TIFF/NetCDF é baixado para disco, não há cache de imagens em arquivos nem service worker. Respostas HTTP usam `Cache-Control: no-store`.

Exemplo medido em 13/10/2026, qualidade econômica: `165_2026_10_09_NDCI.tif` (175.246.172 bytes) requereu aproximadamente 3,3 MiB, e o RGB (262.854.182 bytes), 4,9 MiB. Cada prévia fez aproximadamente 97 leituras de intervalo e demorou cerca de 6–7 segundos neste ambiente. O resultado varia com a área, resolução, rede e recorte.

**Não é custo AWS zero:** há requisições LIST/GET e saída de dados quando aplicável. Não cria EC2, Lambda, CloudFront, bucket, índices remotos ou cópias derivadas. Não faz polling, não executa análises e não mantém infraestrutura adicional. Evita prometer tarifas fixas: consulte a cobrança efetiva da sua conta/região. Miniaturas ou COGs gerados pelo pipeline poderão reduzir ainda mais as requisições no futuro.

## Interpretação e limites

- As prévias são amostras pontuais, não médias e não análises científicas completas. Feições estreitas podem não aparecer; aproxime um trecho para examiná-las.
- NDCI, NDVI e NDVI2 usam escala visual fixa de −1 a +1; valores fora dela são saturados apenas na exibição. A legenda não representa classes de risco ou concentração de clorofila.
- RGB usa contraste dos percentis 2–98 da prévia e ajuste visual de gama. Esse contraste pode variar entre datas; não se deve interpretar diferenças de brilho como diferenças quantitativas.
- NaN e NoData são transparentes; RGB inteiramente zero é tratado como fundo. Sem inferência de ausência de nuvens ou validação científica da máscara.
- Data no nome = aquisição, não execução. A existência de um TIFF não atesta que a execução diária concluiu. A interface não diagnostica o ID 165 nem substitui o relatório do processamento.
- Não busca alertas do banco/API nem classifica sucesso de jobs: esta versão consulta produtos raster publicados.
- Suporta TIFFs sem compressão, em faixas, com 1 ou 3 bandas intercaladas. Outros layouts são recusados com mensagem, em vez de disparar download integral. Suporte COG pode ser adicionado ao provedor.
- O indicador de bytes conta leituras de prévias concluídas nesta aba, não listagens, tráfego TCP, retries ou tentativas com erro; não é uma medição de faturamento.

## Segurança e arquitetura

O lançador mantém o servidor em um serviço systemd do usuário, iniciado sob demanda e com reinício em caso de falha. Ele escuta em `127.0.0.1` e no IP da interface do WSL. As conexões são aceitas apenas do loopback, do próprio IP do WSL ou do gateway Windows; Host é validado, APIs exigem token por sessão, não há CORS e o navegador não recebe credenciais AWS nem URLs assinadas. Somente chaves encontradas no catálogo podem ser consultadas; `IfMatch` impede misturar versões durante a leitura. Não publique esse servidor diretamente na internet.

- `occulus/core.py`: provedor S3, parser do catálogo e leitor de intervalos com orçamento de transferência.
- `occulus/app.py`: API local e arquivos estáticos.
- `occulus/static/`: interface sem CDN ou serviços de mapas externos.
- `scripts/`: inicialização, encerramento e atalho Windows.
- `tests/`: validação de valores amostrados, recortes, cache, intervalos, formatos e proteção da API.

`create_app(catalog=...)` aceita um provedor com `list()` e `preview()`. Para novas análises, adicione provedores com catálogo/produtos próprios e a navegação correspondente; não é necessário misturar convenções de nomes com Phytobloom.

## Validação

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

Também foram exercitados o catálogo real, NDCI/RGB do ID 165, aproximação, comparação e layout móvel no Chromium. Testes automatizados usam S3 simulado e não consomem AWS. Dependências exatas do ambiente validado estão em `requirements.lock.txt`.

Para consultar o serviço local: `systemctl --user status emperors-occulus.service`. Logs: `journalctl --user -u emperors-occulus.service`. O serviço não é habilitado automaticamente no boot; o atalho inicia quando necessário.
