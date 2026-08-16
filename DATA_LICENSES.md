# Licenças e proveniência dos dados

A licença MIT do arquivo [`LICENSE`](LICENSE) cobre o código e a documentação
originais deste projeto. Ela **não substitui** as condições dos conjuntos de
imagens distribuídos em `exams/library/`.

## Visible Human Male — TC abdominal

- Pacote: `exams/library/visible-human-abdomen-ct/`
- Fonte: [Visible Human Project, U.S. National Library of Medicine](https://www.nlm.nih.gov/research/visible/visible_human.html)
- Imagens de origem: séries radiológicas `normalCT` e `frozenCT`, índices
  1500–1800; a aquisição normal não contém o índice 1557.
- Situação jurídica informada pela NLM: biblioteca em domínio público; desde
  2019 não é exigida licença de acesso.
- Condições adicionais de redistribuição:
  [NLM Terms and Conditions](https://www.nlm.nih.gov/databases/download/terms_and_conditions.html).
- Atribuição exigida: **“Courtesy of the U.S. National Library of Medicine”**.

Este projeto reduz as imagens de 512 × 512 para 256 × 256 por amostragem do
vizinho mais próximo, converte o valor armazenado em HU pela relação
`HU = valor − 1024` e empacota os pixels como Int16/gzip/base64. O manifesto de
cada série registra o intervalo, o hash agregado das imagens-fonte e a
transformação aplicada.

A atribuição não significa que a NLM aprovou, certificou, patrocinou ou mantém
este software. Conforme os termos da NLM, redistribuidores também devem alertar
que os dados podem não estar atuais ou corretos. Não há garantias.

## MRI-DIR — RM sintética T1 multissérie

- Pacote: `exams/library/mri-dir-t1-mr/`
- Coleção: [Synthetic and Phantom MR Images for Determining Deformable Image Registration Accuracy (MRI-DIR)](https://www.cancerimagingarchive.net/collection/mri-dir/)
- Caso: `MRI-DIR-T1_1`, quatro séries (`T1Post1`–`T1Post4`), 56 imagens.
- Licença dos dados: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
- Texto integral: [`LICENSES/CC-BY-4.0.txt`](LICENSES/CC-BY-4.0.txt).
- Aviso fornecido com o download do TCIA:
  [`LICENSES/MRI-DIR-TCIA.txt`](LICENSES/MRI-DIR-TCIA.txt).

As imagens são sintéticas/modeladas a partir de imagens de cabeça e pescoço e
servem à avaliação de registro deformável; não representam uma aquisição
diagnóstica multissequência. O projeto apenas remove os contêineres DICOM do
runtime e reempacota os valores armazenados em chunks Int16, preservando
geometria, ordem e valores de pixel.

Citação dos dados:

> Ger, R. B., Yang, J., Ding, Y., Jacobsen, M. C., Cardenas, C. E., Fuller,
> C. D., Howell, R. M., Li, H., Stafford, R. J., Zhou, S., & Court, L. (2018).
> *Data from Synthetic and Phantom MR Images for Determining Deformable Image
> Registration Accuracy (MRI-DIR)* (Version 1). The Cancer Imaging Archive.
> https://doi.org/10.7937/K9/TCIA.2018.3f08iejt

O TCIA exige que o conjunto específico e o repositório NIH sejam reconhecidos
em apresentações orais ou escritas, divulgações e publicações. É proibido tentar
reidentificar ou contatar participantes. Consulte também a
[política de uso do TCIA](https://wiki.cancerimagingarchive.net/display/Public/Data%2BUsage%2BPolicies%2Band%2BRestrictions).

## Uso pretendido

Os dois pacotes foram incluídos para demonstração técnica, educação e pesquisa.
Não se destinam a diagnóstico, planejamento terapêutico ou tomada de decisão
clínica. Consulte [`CITING.md`](CITING.md) antes de reutilizar imagens em uma
apresentação.
