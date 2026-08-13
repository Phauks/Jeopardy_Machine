// Static sample board for the /dev/theme gallery and component tests. Flavored for the first
// event (Board Game Club x Environmental Law Society: environmental + gaming topics ONLY,
// docs/research/00-user-directives.md). This is display data, not a content pack - when M1
// lands the content/game-definition schemas, gallery data gets generated from a real document
// and these local types retire.

export type BoardClue = {
  value: number;
  clue: string;
  /** Not rendered by the board display (host-only surface); kept so the sample stays honest
   * about the data shape the console will need. */
  response: string;
};

export type BoardCategory = {
  title: string;
  clues: BoardClue[];
};

export type BoardData = {
  /** Currency label prefix for values ("$", "pts " later via settings). */
  currency: string;
  categories: BoardCategory[];
};

function category(title: string, entries: [string, string][]): BoardCategory {
  return {
    title,
    clues: entries.map(([clue, response], index) => ({
      value: (index + 1) * 200,
      clue,
      response,
    })),
  };
}

export const sampleBoard: BoardData = {
  currency: "$",
  categories: [
    category("Board Game Basics", [
      ["Trade sheep, wheat & ore to build roads on this island of hexes", "What is Catan?"],
      ["This little wooden person is the piece you place in Carcassonne", "What is a meeple?"],
      ["Number of pips on the highest face of a standard d20", "What is 20?"],
      [
        "Cooperative game where players cure four diseases before outbreaks win",
        "What is Pandemic?",
      ],
      ["Chess piece that moves in an L and is the only one that can jump", "What is the knight?"],
    ]),
    category("Endangered Species", [
      ["Black-and-white bear whose diet is around 99 percent bamboo", "What is the giant panda?"],
      [
        "World's largest reptile, an ambush hunter of northern Australia",
        "What is the saltwater crocodile?",
      ],
      ["This 'unicorn of the sea' sports a single spiral tusk", "What is the narwhal?"],
      [
        "Mountain ghost cat of the Himalayas, famously hard to photograph",
        "What is the snow leopard?",
      ],
      ["The vaquita, rarest marine mammal, is this kind of cetacean", "What is a porpoise?"],
    ]),
    category("National Parks", [
      ["Park home to Old Faithful and about half the world's geysers", "What is Yellowstone?"],
      ["You can hike rim to rim across this mile-deep Arizona canyon", "What is the Grand Canyon?"],
      [
        "Sequoia trees named General Sherman & General Grant grow in this state",
        "What is California?",
      ],
      ["This Utah park is famous for over 2,000 natural stone arches", "What is Arches?"],
      ["Denali, the tallest peak in North America, rises in this state", "What is Alaska?"],
    ]),
    category("Video Game Classics", [
      ["Italian plumber who first stomped goombas in 1985", "Who is Mario?"],
      ["Falling-block puzzler born in 1984 Moscow", "What is Tetris?"],
      ["This yellow arcade star eats dots and fears four ghosts", "Who is Pac-Man?"],
      ["Hyrule's princess lends her name to this adventure series", "What is The Legend of Zelda?"],
      ["Blocky survival builder where creepers go boom", "What is Minecraft?"],
    ]),
    category("Renewable Energy", [
      ["Panels made of silicon turn this directly into electricity", "What is sunlight?"],
      ["Spinning giants on ridges and offshore farms harvest this", "What is wind?"],
      ["Hoover Dam generates power from this river", "What is the Colorado?"],
      ["Iceland heats most homes with this energy from below", "What is geothermal?"],
      ["Rising and falling twice a day, this ocean motion can spin turbines", "What is the tide?"],
    ]),
    category("Dice & Cards", [
      [
        "Rolling two of these six-siders, seven is the most likely total",
        "What is a pair of dice?",
      ],
      ["Number of cards in a standard deck, jokers aside", "What is 52?"],
      ["Yahtzee's namesake roll: five dice showing this", "What is the same number?"],
      ["The queen of this suit is the 13-point card in Hearts", "What is spades?"],
      ["Snake eyes is this total", "What is two?"],
    ]),
  ],
};
