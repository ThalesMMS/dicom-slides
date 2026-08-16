# Formatos para MPR/reslice e persistência de resultados 3D

Pesquisa realizada em 2026-08-14, usando apenas especificações e documentação oficial.

## Resposta curta

- **Para fazer reslice/MPR**, é necessário preservar o **volume escalar** (por exemplo, HU em `Int16`) e a transformação espacial que leva índices de voxel a coordenadas físicas. DICOM, NIfTI, Zarr/OME-Zarr e o formato customizado deste projeto podem conter dados suficientes.
- **Para MPR eficiente no navegador**, o melhor modelo de distribuição é uma matriz 3D dividida em **bricks**, isto é, chunks que têm extensão limitada nos três eixos. Zarr fornece exatamente esse modelo; OME-Zarr acrescenta eixos, unidades, níveis de resolução e labelmaps.
- **Para guardar um volume que continuará sendo renderizado em 3D**, guarde o volume escalar, não glTF. A câmera, função de transferência, recorte e iluminação são um estado de apresentação separado.
- **Para guardar uma superfície 3D já extraída** (pele, osso ou órgão segmentado), `glTF`/`GLB` é adequado para a web. Ele não preserva os voxels e, portanto, não permite novo windowing, mudança de limiar ou MPR.
- **Para guardar somente a aparência final**, use uma imagem ou vídeo. Isso é uma renderização 2D, não um exame ou modelo 3D reutilizável.

## Três objetos diferentes que costumam ser chamados de “3D”

| Objeto | O que contém | O que ainda pode ser alterado | Formatos apropriados |
|---|---|---|---|
| Volume escalar | Um valor por voxel e geometria física | plano de corte, interpolação, window/level, limiar, função de transferência, câmera | DICOM, NIfTI, Zarr/OME-Zarr, chunks deste projeto |
| Malha/cena | vértices, triângulos, materiais, câmera e transformações | câmera, iluminação e materiais; não os valores internos do exame | glTF/GLB; DICOM Surface Segmentation ou OBJ encapsulado quando o vínculo clínico for importante |
| Imagem/vídeo renderizado | pixels RGB(A) finais | praticamente nada além de exibição | PNG, JPEG/WebP ou vídeo |

Uma malha não substitui o volume. Ela representa apenas superfícies escolhidas por uma segmentação ou limiar. Da mesma forma, uma captura do volume renderizado não contém profundidade nem densidades que permitam reconstruir o exame.

## O que é necessário para um reslice correto

O formato precisa fornecer, no mínimo:

1. matriz 3D completa de valores escalares, sem windowing destrutivo;
2. tipo e significado dos valores (`Int16` em HU, neste projeto);
3. dimensões e espaçamento físico;
4. origem e orientação, idealmente como uma transformação afim 4×4 de voxel para um sistema físico conhecido;
5. posição individual dos cortes quando a amostragem não é uniforme;
6. uma política de interpolação no viewer.

PNG pré-windowed não é suficiente: perdeu precisão e todos os valores fora da janela escolhida. Uma pilha de cortes ainda pode ser suficiente, mas só se sua geometria espacial também for conhecida.

## Comparação dos formatos

### DICOM

DICOM é a melhor fonte canônica clínica. Os objetos de imagem representam pixels, contexto clínico e geometria; os Functional Groups de imagens multi-frame incluem **Pixel Measures**, **Plane Position (Patient)** e **Plane Orientation (Patient)**. O padrão também define um **Planar MPR Volumetric Presentation State**, com geometria para MPR fina ou em slab, recorte, composição e apresentação. Fontes: [DICOM PS3.3 — Common Functional Group Macros](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.7.6.16.2.html) e [DICOM PS3.3 — Volumetric Presentation State IODs](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_a.80.html).

Logo, DICOM contém informação suficiente para MPR, desde que a série seja geometricamente coerente ou seja normalizada antes. Porém, “ser suficiente” não significa “ser o payload mais simples para um site estático”: um cliente precisa interpretar datasets, geometria, modality LUT/rescale e transfer syntaxes. Com DICOMweb, metadados e pixels/frames podem ser obtidos separadamente, mas um MPR client-side transversal ou oblíquo ainda acaba precisando dos voxels atravessados pelo plano; uma alternativa é renderização no servidor. Fonte: [DICOM PS3.18 — Retrieve Transaction](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_10.4.html).

Uso recomendado: manter o DICOM anonimizado como origem/proveniência e gerar um derivado otimizado para o slide. Não substituir o acervo clínico pelos chunks.

### NIfTI

NIfTI é um contêiner compacto e amplamente interoperável para volumes. O header define dimensões, tipo, espaçamento e transformações `qform`/`sform`; a documentação oficial explica que o inverso dessas transformações permite mapear coordenadas físicas para índices e extrair/interpolar a imagem. Fontes: [NIfTI-1 — dimensões e espaçamento](https://nifti.nimh.nih.gov/nifti-1/documentation/nifti1fields/nifti1fields_pages/dim.html/document_view.html) e [NIfTI-1 — qform e sform](https://nifti.nimh.nih.gov/nifti-1/documentation/nifti1fields/nifti1fields_pages/qsform.html/document_view.html).

É uma ótima escolha para um arquivo único de volume derivado e é suficiente para MPR e volume rendering. Sua limitação para este caso é distribuição progressiva: o padrão descreve header seguido do bloco de imagem e não define uma grade interna de chunks 3D. Em um `.nii.gz` comum, o cliente normalmente baixa e descomprime o payload como um todo antes de ter acesso espacial arbitrário. A variante NIfTI-2 amplia dimensões e endereçamento para 64 bits, mas mantém a mesma lógica do NIfTI-1. Fontes: [NIfTI-1 FAQ](https://nifti.nimh.nih.gov/nifti-1/documentation/faq.html) e [NIfTI-2](https://nifti.nimh.nih.gov/nifti-2/).

Uso recomendado: download/intercâmbio e volumes que caibam confortavelmente na memória; menos indicado que Zarr para streaming de MPR no navegador.

### Zarr e OME-Zarr

Zarr define matrizes N-dimensionais tipadas divididas em chunks, com forma da matriz, tipo, grade de chunks e codecs registrados em metadados. Cada chunk é endereçável separadamente no store. Isso permite solicitar somente os bricks que cruzam o plano de reslice e manter cache dos bricks já decodificados. Fonte: [Zarr v3 Core Specification](https://zarr-specs.readthedocs.io/en/latest/v3/core/v3.0.html).

Zarr puro não define semântica médica. OME-Zarr 0.5 acrescenta imagens/volumes de 2 a 5 dimensões, eixos espaciais, unidades, níveis multiscale, transformações por escala/translação e label images. A pirâmide multiscale também é útil para mostrar rapidamente uma versão de baixa resolução antes de carregar bricks finos. Fonte: [OME-Zarr 0.5 Specification](https://ngff.openmicroscopy.org/0.5/).

Limitação importante: no OME-Zarr 0.5 estável, as transformações de cada nível são limitadas a escala e translação. Uma orientação DICOM oblíqua arbitrária não cabe de forma interoperável nessa parte do modelo. Para manter compatibilidade, há duas opções práticas:

- reamostrar o derivado para uma grade ortogonal conhecida antes de escrever OME-Zarr; ou
- preservar a matriz 4×4/orientação LPS em metadado adicional do aplicativo, sabendo que leitores OME-Zarr genéricos podem ignorá-lo.

Uso recomendado neste projeto: melhor base para um viewer web com MPR progressivo, preferencialmente servido por HTTP. O formato não deve ser tratado como substituto da semântica clínica DICOM.

### glTF/GLB

glTF é um formato de entrega de assets 3D: cenas, nós, malhas, materiais, câmeras, animações e texturas. `GLB` empacota JSON e dados binários num único arquivo. Isso combina muito bem com uma superfície extraída do exame e viewers WebGL/WebGPU. Fonte: [Khronos glTF 2.0 Specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).

glTF 2.0 core **não é um formato de volume médico**: a própria especificação limita as texturas a imagens 2D estáticas. Não há no core uma matriz escalar 3D com geometria física e função de transferência padronizadas. Seria possível inventar `extras` ou uma extensão privada, mas isso repetiria o problema de um formato customizado e não seria entendido por viewers glTF comuns.

Uso recomendado: publicar uma malha segmentada pronta, com materiais e câmera inicial; manter em paralelo o volume se o usuário precisar de MPR, windowing ou volume rendering recalculável.

### DICOM para persistir apresentação ou superfície 3D

Quando o objetivo é preservar o estado clínico de um volume rendering, DICOM define o **Volume Rendering Volumetric Presentation State**: registro, crop, geometria, shading, mapeamento escalar para RGB/alpha, composição, anotações e referência a uma imagem que representa a vista. Ele referencia os volumes de origem; não é um substituto autocontido para eles. Fontes: [DICOM PS3.3 — Volume Rendering VPS](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_a.80.2.html) e [DICOM PS3.17 — vantagens e limitações dos Volumetric Presentation States](https://dicom.nema.org/medical/dicom/current/output/chtml/part17/sect_xxx.2.2.html).

Para superfícies, o padrão define **Surface Segmentation**, com vértices e primitivas de malha, e também encapsulamento de OBJ/STL para modelos 3D vinculados ao estudo. Fontes: [DICOM PS3.3 — Surface Mesh Module](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.27.html) e [DICOM PS3.3 — Encapsulated OBJ IOD](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_a.85.2.html).

Essas opções são mais fortes para interoperabilidade/proveniência clínica, enquanto glTF/GLB costuma ser mais simples para entrega visual na web.

## Avaliação dos chunks deste repositório

O `dicom-slide-volume/1` já preserva os valores `Int16` após Rescale Slope/Intercept, além de dimensões, espaçamento, orientação LPS e uma coordenada por corte. Portanto, para a série ortogonal e regular de exemplo, **os pixels são suficientes para implementar MPR local**; falta principalmente o algoritmo do viewer.

Há, porém, dois limites estruturais:

1. cada chunk é uma laje de 12 cortes axiais completos; um corte axial usa uma laje, mas um corte coronal, sagital ou oblíquo atravessa quase todas as lajes e tende a baixar/descomprimir o volume inteiro;
2. o manifesto não guarda a `ImagePositionPatient` tridimensional completa do primeiro frame nem uma matriz voxel→LPS 4×4. `orientationLPS` mais a projeção escalar em `sliceCoordinates` não recuperam a translação completa no espaço do paciente. Isso impede registro confiável com outra série, segmentação ou anotação, mesmo que o MPR isolado pareça correto.

Além disso, gzip+base64 dentro de JavaScript é uma adaptação útil para `file://`, mas o base64 aumenta o payload e cada laje precisa ser decodificada por inteiro. Em GitHub Pages/HTTP, chunks binários eliminariam esse wrapper.

## Recomendação concreta para o projeto

### Se a prioridade continuar sendo “abrir por duplo clique”

Evoluir o formato customizado sem adotar dependências:

- trocar lajes axiais por uma grade de bricks 3D;
- adicionar `chunkShape`, `gridShape`, ordem dos eixos e índice `(z,y,x)` de cada brick;
- adicionar uma matriz afim voxel→LPS 4×4 e, se necessário, posições completas por frame;
- continuar com wrappers `.js`/base64 apenas no pacote `file://`;
- guardar estado de volume rendering em JSON separado: câmera, projeção, crop, função de transferência RGBA, shading e referências ao volume/segmentações.

Isso é suficiente para MPR e volume rendering, mas continua sendo um protocolo privado.

### Se a prioridade for eficiência e interoperabilidade web

Usar duas camadas:

1. **DICOM anonimizado como fonte canônica**;
2. **OME-Zarr/Zarr com chunks 3D como derivado web**, mais metadado explícito para HU e matriz LPS quando necessário.

Escolher o tamanho dos bricks medindo o padrão real de navegação e a compressão; não existe um tamanho universal. Um primeiro teste deve equilibrar axial, coronal, sagital, oblíquo e volume rendering, em vez de otimizar apenas o scroll axial.

Para exportação:

- oferecer NIfTI como arquivo único do volume derivado;
- oferecer GLB somente para malhas segmentadas;
- oferecer PNG/WebP/vídeo para a vista final;
- se houver requisito clínico de reproduzir a apresentação, avaliar DICOM Volumetric Presentation State junto com os objetos DICOM referenciados.

## Decisão resumida

| Necessidade | Escolha recomendada |
|---|---|
| Fonte clínica e proveniência | DICOM |
| MPR simples em arquivo único | NIfTI |
| MPR/volume rendering progressivo no navegador | Zarr/OME-Zarr com bricks 3D |
| Manter o modo `file://` sem dependências | formato customizado evoluído para bricks 3D |
| Persistir parâmetros de volume rendering | estado JSON do app; DICOM VPS quando interoperabilidade clínica justificar |
| Superfície 3D pronta para a web | glTF/GLB |
| Superfície com contexto clínico DICOM | DICOM Surface Segmentation ou OBJ/STL encapsulado |
| Aparência final | PNG/WebP ou vídeo |
