// Deterministic GLB trimmer: the step that makes the 27 avatar models shippable.
//
// Kenney's source GLBs are generous - every character carries 32 animation clips (combat,
// wheelchair driving, weapon holds) and every mesh carries TANGENT + TEXCOORD_1 attributes
// that nothing in our render path reads (the only material texture is baseColorTexture on
// texCoord 0; there is no normal map, so tangents are dead weight). Raw, the 27 models plus
// the wheelchair prop are 4.97 MB. Keeping only the clips the diorama actually plays and
// dropping the unread attributes brings the same models to well under half that - and,
// because unused accessors go with them, the glTF JSON chunk (105 KB of a 263 KB character,
// all of it bufferView bookkeeping) collapses too.
//
// The trim is structural, never lossy on what remains: kept meshes, skins, nodes, materials
// and clips are byte-for-byte the source data, re-packed against a fresh buffer. Nothing is
// re-encoded, quantized, or resampled, so a re-run on the same pinned zips produces
// byte-identical output - the bake's determinism rule (tools/avatar-bake/README.md).

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

/** Attributes no material in these packs reads; see the header note. */
const DROPPED_ATTRIBUTES = ["TANGENT", "TEXCOORD_1"];

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** Bytes one element of an accessor occupies (componentType size x type component count). */
function accessorElementBytes(accessor) {
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const components = TYPE_COMPONENTS[accessor.type];
  if (componentBytes === undefined || components === undefined) {
    throw new Error(`unsupported accessor ${accessor.componentType}/${accessor.type}`);
  }
  return componentBytes * components;
}

/** Split a .glb into its JSON chunk and its binary chunk. */
export function parseGlb(bytes) {
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB (bad magic)");
  let offset = 12;
  let json = null;
  let binary = Buffer.alloc(0);
  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === CHUNK_JSON) json = JSON.parse(chunk.toString("utf8"));
    else if (chunkType === CHUNK_BIN) binary = chunk;
    offset += 8 + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  if (json === null) throw new Error("GLB has no JSON chunk");
  return { json, binary };
}

function pad4(length) {
  return (4 - (length % 4)) % 4;
}

/** Re-emit a JSON + binary pair as a single-buffer .glb, padded exactly per the spec. */
export function writeGlb(json, binary) {
  // Stable key order comes from JSON.stringify walking the object we built in a fixed
  // sequence - the determinism guarantee depends on never iterating a Set/Map by insertion
  // luck, which is why every rebuild below indexes arrays by number.
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadding = Buffer.alloc(pad4(jsonBytes.length), 0x20); // spaces, per spec
  const binaryPadding = Buffer.alloc(pad4(binary.length), 0x00);
  const jsonChunkLength = jsonBytes.length + jsonPadding.length;
  const binaryChunkLength = binary.length + binaryPadding.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunkLength + 8 + binaryChunkLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunkLength, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryChunkLength, 0);
  binaryHeader.writeUInt32LE(CHUNK_BIN, 4);
  return Buffer.concat([
    header,
    jsonHeader,
    jsonBytes,
    jsonPadding,
    binaryHeader,
    binary,
    binaryPadding,
  ]);
}

/**
 * Trim a parsed GLB to `keepClipNames` and re-pack it.
 *
 * Everything except animations and the dropped vertex attributes is preserved as-is; the
 * accessor/bufferView tables are then rebuilt from scratch containing only what the surviving
 * structures still reference, which is where most of the size goes.
 */
export function repackGlb({ json, binary }, keepClipNames) {
  const source = structuredClone(json);

  // 0. These packs reference their shared colormap by URI (Textures/colormap.png), which is
  //    why the models are tiny and the texture ships once. An embedded image would need its
  //    bufferView carried across; fail rather than silently drop the texture.
  for (const image of source.images ?? []) {
    if (image.bufferView !== undefined) {
      throw new Error("GLB embeds an image - repack does not carry image bufferViews");
    }
  }

  // 1. Animations: keep the requested clips, in the source's own order.
  const keep = new Set(keepClipNames);
  const missing = keepClipNames.filter(
    (name) => !(source.animations ?? []).some((animation) => animation.name === name),
  );
  if (missing.length > 0) {
    throw new Error(`clips not present in the source GLB: ${missing.join(", ")}`);
  }
  source.animations = (source.animations ?? []).filter((animation) => keep.has(animation.name));

  // 2. Vertex attributes nothing reads. Guarded: a UV set is only droppable if no material
  //    texture actually samples it, so a future pack that grows a normal map fails loudly
  //    here instead of shipping an untextured avatar.
  const usedTexCoordSets = new Set();
  for (const material of source.materials ?? []) {
    const textureSlots = [
      material.pbrMetallicRoughness?.baseColorTexture,
      material.pbrMetallicRoughness?.metallicRoughnessTexture,
      material.normalTexture,
      material.occlusionTexture,
      material.emissiveTexture,
    ];
    for (const slot of textureSlots) {
      if (slot === undefined) continue;
      usedTexCoordSets.add(slot.texCoord ?? 0);
      const transform = slot.extensions?.KHR_texture_transform;
      if (transform?.texCoord !== undefined) usedTexCoordSets.add(transform.texCoord);
    }
    if (material.normalTexture !== undefined) {
      throw new Error("material has a normal map - TANGENT is no longer droppable");
    }
  }
  for (const mesh of source.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      for (const attribute of DROPPED_ATTRIBUTES) {
        const texCoordMatch = /^TEXCOORD_(\d+)$/.exec(attribute);
        if (texCoordMatch !== null && usedTexCoordSets.has(Number(texCoordMatch[1]))) continue;
        delete primitive.attributes[attribute];
      }
    }
  }

  // 3. Collect every accessor still referenced, then rebuild accessors + bufferViews around
  //    exactly those. Order is derived from a numeric sort of the surviving source indices,
  //    so the output layout is a pure function of the input.
  const referenced = new Set();
  for (const mesh of source.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      for (const accessorIndex of Object.values(primitive.attributes))
        referenced.add(accessorIndex);
      if (primitive.indices !== undefined) referenced.add(primitive.indices);
      for (const target of primitive.targets ?? []) {
        for (const accessorIndex of Object.values(target)) referenced.add(accessorIndex);
      }
    }
  }
  for (const skin of source.skins ?? []) {
    if (skin.inverseBindMatrices !== undefined) referenced.add(skin.inverseBindMatrices);
  }
  for (const animation of source.animations ?? []) {
    for (const sampler of animation.samplers) {
      referenced.add(sampler.input);
      referenced.add(sampler.output);
    }
  }

  const keptAccessorIndices = [...referenced].toSorted((a, b) => a - b);
  const accessorRemap = new Map(keptAccessorIndices.map((index, position) => [index, position]));
  const newAccessors = [];
  const newBufferViews = [];
  const binaryParts = [];
  let binaryLength = 0;
  for (const sourceIndex of keptAccessorIndices) {
    const accessor = { ...source.accessors[sourceIndex] };
    if (accessor.bufferView === undefined) {
      // A zero-filled accessor carries no bytes; it survives untouched.
      newAccessors.push(accessor);
      continue;
    }
    const view = source.bufferViews[accessor.bufferView];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const elementBytes = accessorElementBytes(accessor);
    // These packs write one accessor per bufferView, tightly packed - byteStride, where the
    // exporter bothered to emit it, always equals the element size. A genuinely interleaved
    // view would need its whole stride carried across; fail rather than silently drop
    // vertices, since that is the kind of corruption you only notice on a projector.
    if (view.byteStride !== undefined && view.byteStride !== elementBytes) {
      throw new Error(
        `interleaved bufferView (byteStride ${view.byteStride} != element ${elementBytes})`,
      );
    }
    const bytes = binary.subarray(start, start + accessor.count * elementBytes);
    const padding = pad4(binaryLength);
    if (padding > 0) {
      binaryParts.push(Buffer.alloc(padding, 0));
      binaryLength += padding;
    }
    const newView = { buffer: 0, byteOffset: binaryLength, byteLength: bytes.length };
    if (view.target !== undefined) newView.target = view.target;
    if (view.byteStride !== undefined) newView.byteStride = view.byteStride;
    binaryParts.push(bytes);
    binaryLength += bytes.length;
    accessor.bufferView = newBufferViews.length;
    delete accessor.byteOffset;
    newBufferViews.push(newView);
    newAccessors.push(accessor);
  }

  // 4. Point every reference at its new index.
  for (const mesh of source.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      for (const [name, accessorIndex] of Object.entries(primitive.attributes)) {
        primitive.attributes[name] = accessorRemap.get(accessorIndex);
      }
      if (primitive.indices !== undefined) {
        primitive.indices = accessorRemap.get(primitive.indices);
      }
      for (const target of primitive.targets ?? []) {
        for (const [name, accessorIndex] of Object.entries(target)) {
          target[name] = accessorRemap.get(accessorIndex);
        }
      }
    }
  }
  for (const skin of source.skins ?? []) {
    if (skin.inverseBindMatrices !== undefined) {
      skin.inverseBindMatrices = accessorRemap.get(skin.inverseBindMatrices);
    }
  }
  for (const animation of source.animations ?? []) {
    for (const sampler of animation.samplers) {
      sampler.input = accessorRemap.get(sampler.input);
      sampler.output = accessorRemap.get(sampler.output);
    }
  }

  source.accessors = newAccessors;
  source.bufferViews = newBufferViews;
  const newBinary = Buffer.concat(binaryParts);
  source.buffers = [{ byteLength: newBinary.length }];
  // Generator string is ours now; leaving Kenney's would misattribute the repack. No
  // timestamp or version of ours goes in - that would break byte-identical re-runs.
  source.asset = { ...source.asset, generator: "jeopardy-machine avatar-bake glb-repack" };
  return writeGlb(source, newBinary);
}
