// The design bundle's `N()` helper (design/project/oldcartoons.watch.dc.html)
// never actually set a `name` field, even though its template renders
// `net.name` throughout — a bug in the prototype that would render every
// broadcaster name blank. Fixed here with real display names.
const NAMES = {
  ketnet: 'Ketnet',
  vtm: 'VTM',
  foxkids: 'Fox Kids',
  nickelodeon: 'Nickelodeon',
  nederland3: 'Nederland 3',
  cartoonnetwork: 'Cartoon Network',
  adultswim: 'Adult Swim',
  syndication: 'Syndication',
};

function N(id, ch, color, colorLight, years, note, neutral) {
  return { id, name: NAMES[id], ch, color, colorLight, years, note, neutral };
}

export const NETWORKS = {
  nlbe: [
    N('ketnet', '45', '#3FE0D0', '#0E7A6E', { en: '1997–present', nl: '1997–heden', fr: '1997–présent' }, { en: "VRT's children's channel for Flanders.", nl: 'Het kinderkanaal van de VRT voor Vlaanderen.', fr: 'La chaîne jeunesse de la VRT pour la Flandre.' }),
    N('vtm', '02', '#E838B0', '#9C1F6E', { en: '1989–present', nl: '1989–heden', fr: '1989–présent' }, { en: "Flanders' first commercial channel; imported cartoons filled its afternoons.", nl: 'Vlaanderens eerste commerciële zender; geïmporteerde tekenfilms vulden de namiddag.', fr: "La première chaîne commerciale de Flandre ; des dessins animés importés remplissaient ses après-midis." }),
    N('foxkids', '33', '#4CD97A', '#1F7A3D', { en: '1997–2005', nl: '1997–2005', fr: '1997–2005' }, { en: 'The Benelux feed of the American after-school block.', nl: 'De Benelux-uitzending van het Amerikaanse naschoolse blok.', fr: "Le flux Benelux du bloc américain de l'après-école." }),
    N('nickelodeon', '30', '#F2C94C', '#8A6512', { en: '1998–present', nl: '1998–heden', fr: '1998–présent' }, { en: 'The first Nickelodeon feed for Dutch and Flemish viewers.', nl: 'De eerste Nickelodeon-uitzending voor Nederlandse en Vlaamse kijkers.', fr: 'Le premier flux Nickelodeon pour les téléspectateurs néerlandais et flamands.' }),
    N('nederland3', '03', '#4C8DF2', '#1E4E9C', { en: '1988–present', nl: '1988–heden', fr: '1988–présent' }, { en: "Dutch public television's third channel; home of the after-school block.", nl: 'Het derde net van de Nederlandse publieke omroep; thuis van het naschoolse blok.', fr: "La troisième chaîne de la télévision publique néerlandaise ; foyer du bloc de l'après-école." }),
    N('cartoonnetwork', '38', '#8A93A6', '#6B6A64', { en: '1993–present', nl: '1993–heden', fr: '1993–présent' }, { en: 'The Benelux feed of the cartoon-only channel.', nl: 'De Benelux-uitzending van het kanaal dat uitsluitend tekenfilms toont.', fr: 'Le flux Benelux de la chaîne consacrée uniquement aux dessins animés.' }, true),
  ],
  usa: [
    N('foxkids', '11', '#E838B0', '#9C1F6E', { en: '1990–2002', nl: '1990–2002', fr: '1990–2002' }, { en: 'Weekday afternoons and Saturday mornings, built around action toy lines.', nl: 'Doordeweekse namiddagen en zaterdagochtenden, opgebouwd rond actiespeelgoedlijnen.', fr: "Après-midi en semaine et samedis matin, construits autour de lignes de jouets d'action." }),
    N('cartoonnetwork', '15', '#4CD97A', '#1F7A3D', { en: '1992–present', nl: '1992–heden', fr: '1992–présent' }, { en: 'The first channel programmed entirely from the cartoon vault.', nl: 'Het eerste kanaal dat volledig geprogrammeerd werd vanuit het tekenfilmarchief.', fr: 'La première chaîne entièrement programmée à partir des archives de dessins animés.' }),
    N('ketnet', '45', '#3FE0D0', '#0E7A6E', { en: '1997–present', nl: '1997–heden', fr: '1997–présent' }, { en: "VRT's children's channel for Flanders.", nl: 'Het kinderkanaal van de VRT voor Vlaanderen.', fr: 'La chaîne jeunesse de la VRT pour la Flandre.' }),
    N('adultswim', '31', '#4C8DF2', '#1E4E9C', { en: '2000–present', nl: '2000–heden', fr: '2000–présent' }, { en: 'Late-night reruns for the audience that grew up with them.', nl: 'Laat-avond herhalingen voor het publiek dat ermee opgroeide.', fr: 'Reprises de fin de soirée pour le public qui a grandi avec elles.' }),
    N('syndication', '—', '#8A93A6', '#6B6A64', { en: 'Market by market', nl: 'Per zender', fr: 'Marché par marché' }, { en: 'Sold station by station rather than aired on one channel.', nl: 'Per zender verkocht in plaats van uitgezonden op één kanaal.', fr: 'Vendu station par station plutôt que diffusé sur une seule chaîne.' }, true),
    N('nickelodeon', '08', '#F2C94C', '#8A6512', { en: '1979–present', nl: '1979–heden', fr: '1979–présent' }, { en: 'The first cable channel programmed exclusively for kids.', nl: 'Het eerste kabelkanaal dat uitsluitend voor kinderen werd geprogrammeerd.', fr: 'La première chaîne câblée programmée exclusivement pour les enfants.' }),
  ],
};
