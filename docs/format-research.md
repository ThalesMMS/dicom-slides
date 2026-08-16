# Formats for MPR/reslicing and persistence of 3D results

Research performed on 2026-08-14, using only official specifications and
documentation.

## Short answer

- **To reslice/MPR**, preserve the **scalar volume** (for example, HU in
  `Int16`) and the spatial transform from voxel indices to physical
  coordinates. DICOM, NIfTI, Zarr/OME-Zarr, and this project's custom format
  can contain sufficient data.
- **For efficient browser MPR**, the best delivery model is a 3D array divided
  into **bricks**, meaning chunks with bounded extent along all three axes.
  Zarr provides exactly that model; OME-Zarr adds axes, units, resolution
  levels, and labelmaps.
- **To store a volume that will continue to be rendered in 3D**, store the
  scalar volume, not glTF. Camera, transfer function, cropping, and lighting
  are separate presentation state.
- **To store an already extracted 3D surface** (skin, bone, or a segmented
  organ), `glTF`/`GLB` is suitable for the web. It does not preserve voxels and
  therefore does not allow new windowing, threshold changes, or MPR.
- **To store only the final appearance**, use an image or video. That is a 2D
  rendering, not a reusable study or 3D model.

## Three different objects commonly called “3D”

| Object | What it contains | What can still change | Suitable formats |
|---|---|---|---|
| Scalar volume | One value per voxel and physical geometry | slice plane, interpolation, window/level, threshold, transfer function, camera | DICOM, NIfTI, Zarr/OME-Zarr, this project's chunks |
| Mesh/scene | vertices, triangles, materials, camera, and transforms | camera, lighting, and materials; not the study's internal values | glTF/GLB; DICOM Surface Segmentation or encapsulated OBJ when the clinical link matters |
| Rendered image/video | final RGB(A) pixels | almost nothing beyond display | PNG, JPEG/WebP, or video |

A mesh does not replace the volume. It represents only surfaces chosen by a
segmentation or threshold. Similarly, a capture of the rendered volume contains
neither depth nor densities from which to reconstruct the study.

## Requirements for correct reslicing

At minimum, the format must provide:

1. a complete 3D scalar-value array, without destructive windowing;
2. the values' type and meaning (`Int16` in HU in this project);
3. physical dimensions and spacing;
4. origin and orientation, ideally as a 4×4 affine transform from voxel to a
   known physical coordinate system;
5. an individual slice position when sampling is irregular; and
6. an interpolation policy in the viewer.

Pre-windowed PNG is insufficient: it has lost precision and all values outside
the selected window. A slice stack can still be sufficient, but only if its
spatial geometry is also known.

## Format comparison

### DICOM

DICOM is the best canonical clinical source. Image objects represent pixels,
clinical context, and geometry; multi-frame image Functional Groups include
**Pixel Measures**, **Plane Position (Patient)**, and **Plane Orientation
(Patient)**. The standard also defines a **Planar MPR Volumetric Presentation
State**, with geometry for thin or slab MPR, cropping, compositing, and
presentation. Sources: [DICOM PS3.3 — Common Functional Group Macros](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.7.6.16.2.html)
and [DICOM PS3.3 — Volumetric Presentation State IODs](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_a.80.html).

Therefore, DICOM contains enough information for MPR if the series is
geometrically coherent or normalized first. However, “sufficient” does not mean
“the simplest payload for a static site”: a client must interpret datasets,
geometry, modality LUT/rescale, and transfer syntaxes. With DICOMweb, metadata
and pixels/frames can be retrieved separately, but a transverse or oblique
client-side MPR still needs the voxels crossed by the plane; server rendering is
an alternative. Source: [DICOM PS3.18 — Retrieve Transaction](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_10.4.html).

Recommended use: keep anonymized DICOM as the source/provenance and generate an
optimized derivative for the slide. Do not replace the clinical archive with
chunks.

### NIfTI

NIfTI is a compact, broadly interoperable container for volumes. Its header
defines dimensions, type, spacing, and `qform`/`sform` transforms; the official
documentation explains that the inverse of these transforms maps physical
coordinates to indices and extracts/interpolates the image. Sources:
[NIfTI-1 — dimensions and spacing](https://nifti.nimh.nih.gov/nifti-1/documentation/nifti1fields/nifti1fields_pages/dim.html/document_view.html)
and [NIfTI-1 — qform and sform](https://nifti.nimh.nih.gov/nifti-1/documentation/nifti1fields/nifti1fields_pages/qsform.html/document_view.html).

It is an excellent choice for one derived-volume file and is sufficient for MPR
and volume rendering. Its limitation here is progressive delivery: the standard
describes a header followed by the image block and does not define an internal
3D chunk grid. In an ordinary `.nii.gz`, the client normally downloads and
decompresses the entire payload before arbitrary spatial access. NIfTI-2 expands
dimensions and addressing to 64 bits, but keeps the same NIfTI-1 logic. Sources:
[NIfTI-1 FAQ](https://nifti.nimh.nih.gov/nifti-1/documentation/faq.html) and
[NIfTI-2](https://nifti.nimh.nih.gov/nifti-2/).

Recommended use: download/interchange and volumes that fit comfortably in
memory; less suitable than Zarr for browser MPR streaming.

### Zarr and OME-Zarr

Zarr defines typed N-dimensional arrays divided into chunks, with array shape,
type, chunk grid, and codecs recorded in metadata. Each chunk is independently
addressable in the store. This makes it possible to request only bricks crossed
by the reslice plane and cache already decoded bricks. Source:
[Zarr v3 Core Specification](https://zarr-specs.readthedocs.io/en/latest/v3/core/v3.0.html).

Plain Zarr does not define medical semantics. OME-Zarr 0.5 adds 2- to
5-dimensional images/volumes, spatial axes, units, multiscale levels,
scale/translation transforms, and label images. The multiscale pyramid is also
useful for showing a low-resolution version quickly before fine bricks load.
Source: [OME-Zarr 0.5 Specification](https://ngff.openmicroscopy.org/0.5/).

Important limitation: in stable OME-Zarr 0.5, the transforms for each level are
limited to scale and translation. An arbitrary oblique DICOM orientation does
not fit interoperably in that part of the model. To maintain compatibility,
there are two practical options:

- resample the derivative to a known orthogonal grid before writing OME-Zarr; or
- preserve the 4×4 LPS orientation/matrix in additional application metadata,
  knowing that generic OME-Zarr readers may ignore it.

Recommended use in this project: the best foundation for a progressive-MPR web
viewer, preferably served over HTTP. The format must not be treated as a
replacement for clinical DICOM semantics.

### glTF/GLB

glTF is a delivery format for 3D assets: scenes, nodes, meshes, materials,
cameras, animations, and textures. `GLB` packages JSON and binary data into one
file. This fits a surface extracted from the study and WebGL/WebGPU viewers very
well. Source: [Khronos glTF 2.0 Specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).

glTF 2.0 core **is not a medical-volume format**: the specification itself
limits textures to static 2D images. The core has no 3D scalar array with
physical geometry and standardized transfer function. It would be possible to
invent `extras` or a private extension, but that would repeat the problem of a
custom format and would not be understood by common glTF viewers.

Recommended use: publish a ready segmented mesh, with materials and initial
camera; keep the volume alongside it if the user needs MPR, windowing, or
recomputable volume rendering.

### DICOM for persisting a 3D presentation or surface

When the goal is to preserve a volume-rendering clinical state, DICOM defines a
**Volume Rendering Volumetric Presentation State**: registration, crop,
geometry, shading, scalar-to-RGB/alpha mapping, compositing, annotations, and a
reference to an image representing the view. It references the source volumes;
it is not a self-contained replacement for them. Sources: [DICOM PS3.3 — Volume
Rendering VPS](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_a.80.2.html)
and [DICOM PS3.17 — benefits and limitations of Volumetric Presentation States](https://dicom.nema.org/medical/dicom/current/output/chtml/part17/sect_xxx.2.2.html).

For surfaces, the standard defines **Surface Segmentation**, with mesh vertices
and primitives, and also encapsulation of OBJ/STL for 3D models linked to the
study. Sources: [DICOM PS3.3 — Surface Mesh Module](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.27.html)
and [DICOM PS3.3 — Encapsulated OBJ IOD](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_a.85.2.html).

These options are stronger for clinical interoperability/provenance, whereas
glTF/GLB is usually simpler for visual web delivery.

## Evaluation of this repository's chunks

`dicom-slide-volume/1` already preserves `Int16` values after Rescale
Slope/Intercept, together with dimensions, spacing, LPS orientation, and one
coordinate per slice. Therefore, for the orthogonal, regular example series,
**pixels are sufficient to implement local MPR**; what is principally missing is
the viewer algorithm.

There are two structural limits, however:

1. each chunk is a slab of 12 complete axial slices; an axial slice uses one
   slab, but a coronal, sagittal, or oblique slice crosses nearly every slab and
   tends to download/decompress the whole volume;
2. the manifest does not retain the complete three-dimensional
   `ImagePositionPatient` of the first frame or a voxel→LPS 4×4 matrix.
   `orientationLPS` plus the scalar projection in `sliceCoordinates` cannot
   recover the complete translation in patient space. This prevents reliable
   registration with another series, segmentation, or annotation, even if an
   isolated MPR looks correct.

In addition, gzip+base64 inside JavaScript is a useful adaptation for `file://`,
but base64 increases the payload and each slab must be decoded in full. On
GitHub Pages/HTTP, binary chunks would eliminate this wrapper.

## Concrete recommendation for this project

### If the priority remains “open by double-clicking”

Evolve the custom format without adopting dependencies:

- replace axial slabs with a 3D brick grid;
- add `chunkShape`, `gridShape`, axis order, and `(z,y,x)` index for every
  brick;
- add a voxel→LPS 4×4 affine matrix and, when necessary, complete per-frame
  positions;
- keep `.js`/base64 wrappers only in the `file://` package; and
- store volume-rendering state in separate JSON: camera, projection, crop, RGBA
  transfer function, shading, and references to the volume/segmentations.

This is sufficient for MPR and volume rendering, but remains a private protocol.

### If the priority is web efficiency and interoperability

Use two layers:

1. **Anonymized DICOM as the canonical source**;
2. **OME-Zarr/Zarr with 3D chunks as the web derivative**, plus explicit
   metadata for HU and the LPS matrix when necessary.

Choose brick size by measuring the real navigation and compression pattern; no
universal size exists. An initial test should balance axial, coronal, sagittal,
oblique, and volume rendering, rather than optimizing only axial scrolling.

For export:

- offer NIfTI as one derived-volume file;
- offer GLB only for segmented meshes;
- offer PNG/WebP/video for the final view; and
- if there is a clinical requirement to reproduce the presentation, evaluate
  DICOM Volumetric Presentation State with its referenced DICOM objects.

## Decision summary

| Need | Recommended choice |
|---|---|
| Clinical source and provenance | DICOM |
| Simple MPR in one file | NIfTI |
| Progressive browser MPR/volume rendering | Zarr/OME-Zarr with 3D bricks |
| Keep dependency-free `file://` mode | custom format evolved to 3D bricks |
| Persist volume-rendering parameters | application JSON state; DICOM VPS when clinical interoperability justifies it |
| Ready 3D surface for the web | glTF/GLB |
| Surface with DICOM clinical context | DICOM Surface Segmentation or encapsulated OBJ/STL |
| Final appearance | PNG/WebP or video |
