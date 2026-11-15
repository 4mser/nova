# Anatomy of NOVA's twin

These are reference bodies, not scans of the crew. They are for education and support, not diagnosis.

## Male: BodyParts3D 4.0

BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International.
- License: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html · https://creativecommons.org/licenses/by/4.0/
- Data: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html (`isa_BP3D_4.0_obj_99.zip`)
- Mitsuhashi et al. (2009), BodyParts3D: 3D structure database for anatomical concepts. https://doi.org/10.1093/nar/gkn613
- Browser-ready geometry taken from Human Atlas (MIT code, https://github.com/ashemag/human-atlas):
  axes and units converted to meters with Y up, simplification with meshoptimizer (0.2%), 16-bit normals, binary chunks
  compressed with gzip. All 2,234 original meshes are represented.

## Female: young MakeHuman silhouette + organs from the Human Reference Atlas (NIH HuBMAP)

The skin is the MakeHuman base mesh with its young female targets (about 25 years old; muscle 0.65, weight 0.4; average
features of three ethnicities). MakeHuman base mesh and targets, explicitly released as CC0 (September 2020),
https://github.com/makehumancommunity/makehuman. The organs and skeleton come from the NIH set, fitted inside that
silhouette with `ajustar-mujer.mjs`: horizontal scaling by height only where they do not fit (minimum 0.77), center
aligned to the new body, each leg centered in its own, and the head aligned to the eyes of the new face. This replaces the
skin, fat and breast tissue of the original set, which came from the Visible Human Female (59 years old).

### Organs: Human Reference Atlas (NIH HuBMAP), 3D Reference Organ Set for Female v1.5

Kristen Browne and Heidi Schlehlein, Human Reference Atlas / HuBMAP, *3D Reference Organ Set for Female v1.5* (2023). CC BY 4.0.
- DOI: https://doi.org/10.48539/HBM352.BTSQ.586
- Original GLB: https://cdn.humanatlas.io/digital-objects/ref-organ/united-female/v1.5/assets/3d-vh-f-united.glb
- Adaptation (`convertir-mujer.mjs`, then `ajustar-mujer.mjs`): feet on the floor and centered in x/z, welded vertices,
  simplification with meshoptimizer (0.3% relative error), recomputed normals, body systems assigned by name. The pregnancy
  structures and the enlarged lymph node model are left out. Skeleton and muscles are partial in this set.

## Spaceflight figures

Bone and muscle loss rates, SANS, kidney stones and spine: NASA Human Research Program (Human Research Roadmap) and public
NASA fact sheets, cited in each card (`gemelo-fichas.js`).
