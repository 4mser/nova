# Anatomía del gemelo de NOVA

Cuerpos de referencia, no escáneres de la tripulación. Uso educativo y de apoyo, no diagnóstico.

## Hombre — BodyParts3D 4.0

BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International.
- Licencia: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html · https://creativecommons.org/licenses/by/4.0/
- Datos: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html (`isa_BP3D_4.0_obj_99.zip`)
- Mitsuhashi et al. (2009), BodyParts3D: 3D structure database for anatomical concepts. https://doi.org/10.1093/nar/gkn613
- Geometría lista para el navegador tomada de Human Atlas (código MIT, https://github.com/ashemag/human-atlas):
  ejes y unidades a metros/Y arriba, simplificación con meshoptimizer (0,2 %), normales en 16 bits, bloques binarios
  comprimidos con gzip. Las 2.234 mallas originales están representadas.

## Mujer — silueta joven de MakeHuman + órganos del Human Reference Atlas (NIH HuBMAP)

La piel es la malla base de MakeHuman con sus targets de mujer joven (~25 años; músculo 0,65, peso 0,4; rasgos
promedio de tres etnias). MakeHuman base mesh and targets, explicitly released as CC0 (septiembre 2020),
https://github.com/makehumancommunity/makehuman. Los órganos y el esqueleto son los del set del NIH, ajustados dentro
de esa silueta con `ajustar-mujer.mjs`: escala horizontal por altura solo donde no caben (mínimo 0,77), centro alineado
al cuerpo nuevo, cada pierna centrada en la suya y la cabeza alineada a los ojos de la cara nueva. Se reemplazan la piel,
la grasa y el tejido mamario del set original, que venía de la Visible Human Female (59 años).

### Órganos — Human Reference Atlas (NIH HuBMAP), 3D Reference Organ Set for Female v1.5

Kristen Browne and Heidi Schlehlein, Human Reference Atlas / HuBMAP, *3D Reference Organ Set for Female v1.5* (2023). CC BY 4.0.
- DOI: https://doi.org/10.48539/HBM352.BTSQ.586
- GLB original: https://cdn.humanatlas.io/digital-objects/ref-organ/united-female/v1.5/assets/3d-vh-f-united.glb
- Adaptación (`convertir-mujer.mjs`, luego `ajustar-mujer.mjs`): pies en el piso y centro en x/z, vértices soldados, simplificación con
  meshoptimizer (error relativo 0,3 %), normales recalculadas, sistemas asignados por nombre. Se dejan fuera las
  estructuras del embarazo y el modelo de ganglio linfático aumentado. Esqueleto y músculos son parciales en este set.

## Cifras del espacio

Tasas de pérdida de hueso y músculo, SANS, cálculos renales y columna: NASA Human Research Program (Human Research
Roadmap) y hojas públicas de la NASA, citadas en cada ficha (`gemelo-fichas.js`).
