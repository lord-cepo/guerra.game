export function actions(move = 1, options = {}) {
    const result = move > 0 ? [{ type: 'move', maxDistance: move }] : [];
    if (options.fly)
        result.push({ type: 'fly', maxDistance: options.fly });
    if (options.attack)
        result.push({ type: 'attack', range: options.attack[0], ...(options.attack[1] === undefined ? {} : { damage: options.attack[1] }) });
    if (options.defense)
        result.push({ type: 'defense', block: options.defense[0], range: options.defense[1] });
    if (options.magic)
        result.push({ type: 'magic', damage: options.magic[0], range: options.magic[1] });
    if (options.cannon)
        result.push({ type: 'cannon', damage: options.cannon[0], range: options.cannon[1] });
    if (options.push)
        result.push({ type: 'push', maxDistance: options.push[0], range: options.push[1] });
    if (options.mending)
        result.push({ type: 'mending', amount: options.mending[0], range: options.mending[1] });
    if (options.upgrade)
        result.push({ type: 'upgrade', ...options.upgrade });
    return result;
}
// M magic C cannon S shield P push F fly B boot R ranged H health U upgrade D mending
// deploymentRegions: starting 1, intermediate 2, front 3
export const troopSeeds = [
    // Database cards may be chosen by either side; `player` is only the
    // deck-builder display fallback. Queen Bee is a fragile ranged hero.
    { id: 'queen-bee', name: 'Queen Bee', player: 1, role: 'hero', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(2, { attack: [3, 3] }) },
    { id: 'bramble-empress', name: 'Bramble Empress', player: 1, role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { push: [3, 1] }) },
    { id: 'tiger-queen', name: 'Tiger Queen', player: 1, role: 'hero', baseHealth: 6, deploymentRegions: ['starting'], actions: actions(2) },
    { id: 'ember-salamander', name: 'Ember Salamander', player: 1, role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { magic: [3, 2] }) },
    { id: 'moss-tortoise', name: 'Moss Tortoise', player: 1, role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { defense: [2, 2] }) },
    { id: 'steppe-lynx', name: 'Steppe Lynx', player: 1, role: 'troop', baseHealth: 3, deploymentRegions: ['starting'], actions: actions(1, { attack: [1] }) },
    { id: 'canyon-ibex', name: 'Canyon Ibex', player: 1, role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(3), passiveDescription: '+2 if ⚔️' },
    { id: 'marsh-badger', name: 'Marsh Badger', player: 1, role: 'troop', baseHealth: 4, deploymentRegions: ['starting', 'intermediate'], actions: actions(), passiveDescription: '-1 if 🛡️' },
    { id: 'dune-scorpion', name: 'Dune Scorpion', player: 1, role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { attack: [3] }), deploymentRule: 'enemy-region' },
    { id: 'snowy-owl', name: 'Snowy Owl', player: 1, role: 'troop', baseHealth: 1, deploymentRegions: ['starting'], actions: actions(1, { attack: [3] }) },
    { id: 'squirrel-king', name: 'Squirrel King', player: 2, role: 'hero', baseHealth: 4, deploymentRegions: ['starting'], actions: actions(1, { magic: [1, 3] }), passiveDescription: '🔥: +1❤️' },
    { id: 'cave-viper', name: 'Cave Viper', player: 2, role: 'troop', baseHealth: 2, deploymentRegions: ['front'], actions: actions(0, { magic: [2, 3] }), passiveDescription: '🥾0' },
    { id: 'river-otter', name: 'River Otter', player: 2, role: 'troop', baseHealth: 3, deploymentRegions: ['starting'], actions: actions(), passiveDescription: '+1 if 🛡️' },
    { id: 'coastal-heron', name: 'Coastal Heron', player: 2, role: 'troop', baseHealth: 1, deploymentRegions: ['intermediate'], actions: actions(1, { magic: [2, 3] }) },
    { id: 'desert-fox', name: 'Desert Fox', player: 2, role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(2, { magic: [3, 1] }) },
    { id: 'iron-armadillo', name: 'Iron Armadillo', player: 2, role: 'troop', baseHealth: 1, deploymentRegions: ['starting', 'intermediate'], actions: actions(1, { defense: [3, 1] }) },
    { id: 'volcanic-gecko', name: 'Volcanic Gecko', player: 2, role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: actions(1, { magic: [4, 1] }) },
    { id: 'highland-hawk', name: 'Highland Hawk', player: 2, role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: actions(1, { attack: [2] }) },
    { id: 'ironscale-rhino', name: 'Ironscale Rhino', player: 1, role: 'troop', baseHealth: 5, deploymentRegions: ['starting'], actions: actions(1, { defense: [3, 2] }), deploymentRule: 'enemy-region' },
    { id: 'sahel-porcupine', name: 'Sahel Porcupine', player: 1, role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(2, { attack: [1, 1] }), passiveDescription: '⚔️: +1🏹+1' },
    { id: 'alps-lone-wolf', name: 'Alps Lone Wolf', player: 1, role: 'troop', baseHealth: 3, deploymentRegions: ['starting'], actions: actions(2), passiveDescription: '🩸: +2' },
    { id: 'canyon-hawk', name: 'Canyon Hawk', player: 1, role: 'troop', baseHealth: 3, deploymentRegions: ['front'], actions: actions(0, { fly: 2 }), passiveDescription: 'Steady' },
    { id: 'cinder-heron', name: 'Cinder Heron, Rice Farmer', player: 1, role: 'troop', baseHealth: 2, deploymentRegions: ['starting'], actions: actions(0, { fly: 3 }) },
    { id: 'walnut-crab', name: 'Walnut Crab', player: 1, role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { cannon: [1, 3], defense: [2, 0] }) },
    { id: 'coconut-crab', name: 'Coconut Crab', player: 1, role: 'troop', baseHealth: 1, deploymentRegions: ['starting'], actions: actions(1, { cannon: [2, 3] }) },
    { id: 'push-warden', name: 'Reed Warden', player: 1, role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(1, { push: [2, 1] }), selfDefense: 2 },
    { id: 'push-scout', name: 'Bramble Scout', player: 1, role: 'troop', baseHealth: 2, deploymentRegions: ['intermediate'], actions: actions(2, { push: [1, 2] }) },
    { id: 'spring-temple', name: 'Spring Temple', player: 1, role: 'temple', baseHealth: 3, deploymentRegions: ['starting', 'intermediate'], actions: actions(0, { mending: [1, 3] }) },
    { id: 'oracle-temple', name: 'Oracle Temple', player: 1, role: 'temple', baseHealth: 2, deploymentRegions: ['front'], actions: actions(0, { upgrade: { left: 1, right: 0, range: 1 } }) },
    { id: 'water-temple', name: 'Water Temple', player: 1, role: 'temple', baseHealth: 3, deploymentRegions: ['intermediate'], actions: actions(0, { upgrade: { left: 1, right: 1, range: 2 } }), deploymentRule: 'enemy-region' },
    { id: 'war-temple', name: 'War Temple', player: 1, role: 'temple', baseHealth: 1, deploymentRegions: ['front'], actions: actions(0), passiveDescription: '+1 if ⚔️' },
];
