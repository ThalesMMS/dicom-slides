# DICOM Slide

Visualizador médico estático com pilha 2D, MPR triplanar e renderização 3D por
raycasting WebGL2. O mesmo payload Int16 alimenta os três modos, sem cópia
NIfTI/Zarr e sem backend.

> **Uso demonstrativo, educacional e de pesquisa. Não destinado a diagnóstico
> ou tomada de decisão clínica.**

## Demonstração local

Abra `index.html` diretamente. O projeto e os exames incluídos são compatíveis
com `file://`.

Se o navegador bloquear scripts locais, execute:

```console
python serve.py
```

No Windows também é possível usar `serve.bat`; no macOS/Linux,
`./serve.command`. O runtime não exige `npm install`, CDN, servidor de aplicação
ou dependência JavaScript externa.

## Estudos incluídos

| Estudo | Séries | Imagens | Dimensões | Licença dos dados |
|---|---:|---:|---|---|
| Visible Human Male — TC abdominal | 2 (normal e após congelamento) | 401 | 256 × 256 × 100/301 | Domínio público + termos NLM |
| MRI-DIR — RM sintética T1 | 4 (`T1Post1`–`T1Post4`) | 56 | 256 × 256 × 14 | CC BY 4.0 |

O CT é um derivado reprodutível das imagens PNG oficiais da NLM: índices
abdominais 1500–1800, redução 2× no plano e conversão `HU = valor − 1024`. A
série normal tem a lacuna de aquisição 1557. A RM é o caso `MRI-DIR-T1_1` do
TCIA; suas quatro séries são imagens sintéticas/modeladas para pesquisa de
registro deformável, e não um exame clínico multissequência.

Leia [`DATA_LICENSES.md`](DATA_LICENSES.md) antes de redistribuir as imagens e
[`CITING.md`](CITING.md) antes de usá-las em uma apresentação. Em particular:

- Visible Human: **“Courtesy of the U.S. National Library of Medicine”**. A
  atribuição não implica endosso da NLM.
- MRI-DIR: cite Ger et al. (2018), TCIA,
  [doi:10.7937/K9/TCIA.2018.3f08iejt](https://doi.org/10.7937/K9/TCIA.2018.3f08iejt),
  CC BY 4.0.

## Incorporar em outra apresentação HTML

Carregue o script clássico e declare o Web Component:

```html
<div style="width:100%;height:70vh">
  <script src="../dicom-slide/runtime/dicom-slide.js"></script>
  <dicom-study-viewer
    study-id="mri-dir-t1-mr"
    src="../dicom-slide/exams/library/mri-dir-t1-mr/study.js"
    series="1">
  </dicom-study-viewer>
</div>
```

O componente inclui seletor de séries, ferramentas 2D, presets, MPR, 3D,
expansão e reset. Os atributos iniciais opcionais são `series`, `mode`,
`preset`, `slice` e `tool`. Integrações JavaScript podem aguardar
`element.ready` e chamar `setSeries`, `setMode`, `setSlice`, `setPreset`,
`setWindow`, `setTool`, `setExpanded`, `reset` ou `getState`.

O contrato completo está em [`runtime/README.md`](runtime/README.md). O adapter
opcional por query string/`postMessage` está em `runtime/iframe/index.html`.

## Controles principais

- `2D`: pilha axial convencional.
- `MPR`: planos axial, coronal e sagital sincronizados.
- `3D`: raycasting WebGL2 com funções de transferência.
- `D`: alterna 2D → MPR → 3D; `Esc`: retorna a 2D.
- `W`, `M`, `Z`, `S`: Window/Level, Pan, Zoom e Scroll.
- `R`: rotação em 3D.
- `1`–`5`: presets Default, Abdomen, Lung, Bone e Brain.
- Roda do mouse: percorre cortes em 2D/MPR e aplica zoom em 3D.
- Botão direito/`Alt` + arraste: zoom; botão do meio/`Shift` + arraste: pan.

Em 2D, só o chunk necessário permanece no cache, com prefetch dos vizinhos. Na
primeira abertura de MPR ou 3D, os chunks da série ativa são montados de forma
preguiçosa em um volume contínuo. O limite de segurança da CPU é 512 MiB; o
payload da GPU é reduzido quando necessário para respeitar o limite de textura
3D.

## Formato de dados

```text
dicom-slide-study/1
  study.js
  study.json
  series/<id>/
    manifest.js
    manifest.json
    chunks/
      chunk-000.js  # Int16 little-endian → gzip → base64 → script local
```

Os scripts registram os dados sem `fetch`, por isso funcionam em `file://`.
Geometria LPS, espaçamento, coordenadas dos cortes, janela, presets e
proveniência permanecem nos manifestos.

## Processar um novo exame DICOM

Coloque o diretório ou ZIP bruto em `exams/inbox/` (ignorado pelo Git) e gere o
pacote estático:

```console
python tools/convert_study.py exams/inbox/exam.zip exams/library/novo-exame \
  --study-id novo-exame \
  --title "Novo exame" \
  --chunk-size 12
```

O conversor aceita imagens single-frame monocromáticas/RGB, Implicit/Explicit
VR Little Endian e Explicit VR Big Endian. JPEG 2000 single-frame pode ser
decodificado pelo Pillow; outras sintaxes comprimidas exigem `gdcmconv` somente
no ambiente de conversão. O navegador continua sem dependências.

Dependências opcionais de conversão:

```console
python -m pip install -r requirements-conversion.txt
```

## Reproduzir o CT do Visible Human

O importador baixa as duas séries oficiais, valida os PNGs, registra hashes e
só então publica o pacote de forma atômica:

```console
python tools/import_visible_human.py exams/library/visible-human-abdomen-ct \
  --start 1500 --end 1800 --downsample 2 --chunk-size 12 \
  --cache-dir /caminho/para/cache
```

## Validar

```console
python tools/validate_project.py exams/library/visible-human-abdomen-ct
python tools/validate_project.py exams/library/mri-dir-t1-mr
python -m unittest discover -s tests/python -v
node tests/javascript/test_volume_integration.js
```

O validador confere manifestos, séries, contagens, scripts, base64, gzip e o
tamanho exato dos buffers descomprimidos.

## Estrutura

```text
index.html
runtime/                 viewer reutilizável
presentation/            deck modular
exams/
  inbox/                 fontes brutas ignoradas pelo Git
  library/               dois pacotes de demonstração
tools/                    conversores, importador e validador
tests/                    testes Python, JavaScript e navegador
LICENSE                   código/documentação: MIT
DATA_LICENSES.md          licenças e proveniência das imagens
CITATION.cff              metadados de citação para o GitHub
CITING.md                 texto pronto para apresentações
```

Cada slide é um documento independente em
`presentation/slides/<número-nome>/index.html`. A ordem fica em
`presentation/slides.js`; veja [`presentation/README.md`](presentation/README.md).

## Licenças

O código e a documentação original são distribuídos sob a licença MIT. Os
dados de imagem mantêm suas próprias condições: Visible Human/NLM e
MRI-DIR/TCIA CC BY 4.0. Consulte [`DATA_LICENSES.md`](DATA_LICENSES.md); os
textos aplicáveis estão em [`LICENSES/`](LICENSES/).
