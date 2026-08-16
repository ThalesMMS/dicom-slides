# Fluxo de exames

1. Put the raw DICOM directory or ZIP in `exams/inbox/`.
2. Convert it into a browser package:

   ```console
   python tools/convert_study.py exams/inbox/my-exam.zip exams/library/my-exam --study-id my-exam
   ```

3. Validate the result:

   ```console
   python tools/validate_project.py exams/library/my-exam
   ```

4. Reference `exams/library/my-exam/study.js` from a `<dicom-study-viewer>`.

O `inbox/` é ignorado intencionalmente. `library/` contém pacotes JavaScript
processados e autorregistráveis que funcionam por HTTP e `file://`.

Os dados incluídos têm licenças próprias, diferentes da licença MIT do código.
Leia [`../DATA_LICENSES.md`](../DATA_LICENSES.md) antes de adicionar,
redistribuir ou apresentar imagens.
