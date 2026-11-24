// Every external asset the game uses. All of them are CC0 (public domain) from Poly Haven
// (https://polyhaven.com). `npm run fetch-assets` downloads them into public/assets/.
// Kept free of browser APIs so the Node download script can import it too.

export const TEXTURES = {
  ground: 'sandy_gravel_02',          // range floor
  pad: 'concrete_floor_worn_001',     // firing line slab
  wall: 'concrete_wall_008',          // perimeter walls
  wood: 'weathered_planks',           // benches, posts, signs
  roof: 'rusty_corrugated_iron',      // shelter roof
  terrain: 'dry_ground_01',           // outer hills
  berm: 'rocky_gravel',               // earth berms / backstop
  plywood: 'plywood',                 // lane partitions
  // Rainforest (Rimba Basin)
  forestFloor: 'forest_floor',        // leaf litter under the canopy
  mud: 'mud_forest',                  // trails, riverbanks, clearings
  mossRock: 'mossy_rock',             // river bed, boulders
  bark: 'bark_brown_02',              // hut posts, logs
  palmBark: 'palm_tree_bark',         // palm trunks
  thatch: 'thatch_roof_angled',       // hut roofs
  bamboo: 'bamboo_wall',              // hut walls
  planks: 'old_planks_02',            // hut floors, jetty, bridge deck
};

// Which textures / models each map actually loads (everything is downloaded once).
export const MAP_ASSETS = {
  range: {
    textures: ['ground', 'pad', 'wall', 'wood', 'roof', 'terrain', 'berm', 'plywood'],
    models: null, // all
  },
  rimba: {
    textures: ['forestFloor', 'mud', 'mossRock', 'bark', 'palmBark', 'thatch', 'bamboo', 'planks', 'wood'],
    models: ['fern_02', 'stone_fire_pit', 'wooden_crate_01', 'wooden_bucket_01', 'wicker_basket_01', 'wooden_lantern_01',
      'tree_stump_01', 'rock_moss_set_01', 'rock_moss_set_02', 'shrub_03', 'dead_tree_trunk', 'barrel_03',
      'metal_jerrycan_green', 'ammo_box', 'wooden_military_crate', 'old_military_crate'],
  },
};

// Which Poly Haven maps we pull, and the local filename for each.
export const TEXTURE_MAPS = { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm' }; // arm = AO / Roughness / Metalness packed
export const TEXTURE_RESOLUTIONS = ['1k', '2k'];

export const HDRI = { name: 'kloofendal_48d_partly_cloudy_puresky', resolutions: ['1k', '2k'] };

export const MODELS = [
  'wooden_military_crate',
  'old_military_crate',
  'ammo_box',
  'barrel_03',
  'concrete_road_barrier',
  'metal_jerrycan_green',
  'wooden_crate_02',
  'old_tyre',
  'plastic_crate_01',
  'portable_searchlight',
  'dead_tree_trunk',
  'rock_face_01',
  // rainforest
  'fern_02',
  'stone_fire_pit',
  'wooden_crate_01',
  'wooden_bucket_01',
  'wicker_basket_01',
  'wooden_lantern_01',
  'tree_stump_01',
  'rock_moss_set_01',
  'rock_moss_set_02',
  'shrub_03',
];
