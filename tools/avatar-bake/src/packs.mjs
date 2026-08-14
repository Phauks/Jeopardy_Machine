// The two Kenney source packs (both CC0 1.0 - License.txt inside each zip; see also
// apps/web/static/avatars/LICENSES.md). kenney.nl asset pages embed these direct media URLs
// in their HTML; they are versioned (the hash+timestamp path segment), so a pack update means
// a NEW url + sha256 here, deliberately, followed by a re-bake.
export const packs = {
  "cube-pets": {
    title: "Cube Pets (1.0)",
    pageUrl: "https://kenney.nl/assets/cube-pets",
    zipUrl:
      "https://kenney.nl/media/pages/assets/cube-pets/44e58e945f-1774520254/kenney_cube-pets_1.0.zip",
    // Pinned so every re-bake provably starts from the same bytes (bake determinism).
    sha256: "b3bdc99a2ec92c687b875718c5d01e9231d2711ed0e2845f295b474bb42a1283",
    modelFile: (id) => `Models/GLB format/animal-${id}.glb`,
    colormapFile: "Models/GLB format/Textures/colormap.png",
  },
  "mini-characters": {
    title: "Mini Characters (1.0)",
    pageUrl: "https://kenney.nl/assets/mini-characters",
    zipUrl:
      "https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip",
    sha256: "9e1d48e6d7b8479ebbe84df71eb5bd8e1b3f0da546dea641890dccc8a02d0999",
    modelFile: (id) => `Models/GLB format/character-${id}.glb`,
    colormapFile: "Models/GLB format/Textures/colormap.png",
  },
};
