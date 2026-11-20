# Journal — ranger les textes d'aide (version 2.11.0)

Branche `aide-en-jeu`, partie de `main` (`b7358df`, où les demandes de fusion nº 6 à 9 sont
fusionnées). Le plan suivi est `claude/textes-aide-plan-rangement.md` (fichier du projet), avec
les décisions de Florian du 20 novembre 2026. Ce journal dit ce qui a été fait lot par lot, ce
qui s'écarte du plan et pourquoi, et donne les tables à relire : « ancienne clé → nouvelle
place », les textes des bulles, des infobulles, des astuces et de la leçon.

Rien n'est touché dans `src/sim` : ni singe à 10 000 ordres, ni mesure du joueur automatique.
Chaque lot s'est fermé sur les tests (`npm test`), le lint, la construction de
`dist/index.html`, l'essai de fumée entier et la mesure des dix fiches.

## La mesure des dix fiches

`tools/smoke/sheets.mjs` refait les dix fiches du graphique de « En bref » : il ouvre
`dist/index.html` depuis le disque dans Chrome sans écran, en 1440 × 900, réglages Standard,
met chaque fiche dans l'état du plan et mesure le bas du dernier élément visible de
`#unit-body`. Lancé sur la 2.10.5, il redonne les dix valeurs « aujourd'hui » du plan au pixel
près (972, 923, 753, 692, 683, 528, 433, 412, 270, 294) : la méthode est donc la même.
`--gate` sort en erreur si une fiche dépasse sa valeur « aide rangée » de plus de 10 px.

| Fiche | Visible | 2.10.5 | Cible « aide rangée » | 2.11.0 | Écart à la cible |
| --- | --- | --- | --- | --- | --- |
| Groupe d'escorte en mer (Atlantique) | 626 | 972 | 629 | 614 | −15 |
| Groupe d'escorte au port (Atlantique) | 626 | 923 | 535 | 493 | −42 |
| Escadrille au sol (Kanalkampf) | 626 | 753 | 681 | 681 | 0 |
| Big wing, onglet Commandes | 626 | 692 | 645 | 645 | 0 |
| Patrouille Whitley au sol (Atlantique) | 626 | 683 | 611 | 611 | 0 |
| Convoi en haute mer (Atlantique) | 689 | 528 | 369 | 347 | −22 |
| Convoi HX 55 en mer (Kanalkampf) | 689 | 433 | 253 | 253 | 0 |
| Convoi côtier au port (Kanalkampf) | 689 | 412 | 330 | 330 | 0 |
| Big wing, onglet Rassemblement | 626 | 270 | 182 | 182 | 0 |
| Biggin Hill, onglet Ordres | 759 | 294 | 174 | 174 | 0 |

Six fiches tombent sur leur cible au pixel près ; quatre sont en dessous (voir « Écarts au
plan », points 3 et 4). Les deux fiches d'escorte tiennent dans la fenêtre sans défiler.
Les captures avant et après, côte à côte, sont dans `docs/aide-en-jeu/` (une image par
fiche, le panneau de la fiche seul).

## Lot par lot

### Préparation

- Branche `aide-en-jeu` depuis `main`. Outil de mesure `tools/smoke/sheets.mjs`. Deux écarts
  entre le plan et le code, trouvés en refaisant les mesures : aucune formation n'existe au
  début d'un scénario (l'outil crée la big wing par la page Formations), et la valeur du plan
  pour l'onglet Rassemblement (270 px) n'est retrouvée qu'avec une big wing d'une seule
  escadrille (la 242) : c'est l'état mesuré, l'outil le reprend.

### Lot 1 — séparer l'état de l'aide

- Deux styles : `.state-line` (texte droit, jamais replié ; `.awaited` en ocre, `.warn` et
  `.warn-line` en brun-rouge) et `.hint`, qui ne garde que l'aide.
- Chaque ligne « Garder » des tableaux reclassée ; les onze phrases « Couper en deux »
  coupées : l'état d'un côté, l'aide de l'autre.
- Porte tenue : aides repliées, aucune ligne d'état ne disparaît. L'essai de fumée le
  vérifie sur « En l'air 5 min après l'ordre de décoller. », « Désengagée de H01. » et un
  tracé en attente sous silence radio (étape « state lines stay with the help folded »).
- **Une faute de méthode, corrigée** : j'ai d'abord fermé ce lot sur le seul groupe
  « interface » de l'essai de fumée. L'essai entier a ensuite montré quatre vérifications du
  groupe « quarts » qui lisaient encore `.hint.awaited` et les anciennes phrases. Elles
  lisent maintenant `.state-line.awaited` et les phrases raccourcies (commit à part). Depuis,
  chaque lot est fermé sur l'essai de fumée entier.

### Lot 2 — le « ? » de section

- `section()` et `subTitle()` (`src/ui/commands.js`) reçoivent la clé d'aide et posent le
  « ? » dans le titre. La bulle (`src/ui/helpBubble.js`) s'ouvre au premier plan, à côté du
  « ? » ; Échap, un clic ailleurs, sa croix ou un second clic sur le « ? » la ferment. Son
  lien ouvre l'aide par `openHelp(app, onglet, ancre)`.
- `src/ui/helpTopics.js` : une entrée par bulle, avec la rubrique d'aide où elle mène.
- Onglets sans sections : le « ? » est à côté de « Stock minimum », « Envoyer un train »,
  « Lieu du rassemblement ».
- Réglage « Aides des fiches » : *Masquées (un « ? » par section)* par défaut, *Affichées*
  pour qui débute (le texte de chaque bulle sous le titre de sa section ; le « ? » reste,
  pour le lien vers l'aide).
- Reprise des réglages enregistrés : voir « Écarts au plan », point 1.
- Le « ? » agrandissait de 3 px la ligne de chaque titre (15 px sur une fiche à cinq
  sections) : ses marges verticales sont négatives, le titre garde sa hauteur.
- Porte tenue : par défaut, aucune phrase d'aide dans une fiche ; un seul « ? » par section
  qui a une aide ; un clic ouvre la bulle, Échap la ferme, son lien ouvre la bonne rubrique.

### Lot 3 — ranger les phrases

- Les tableaux appliqués ligne par ligne : voir la table « ancienne clé → nouvelle place ».
- Textes jamais affichés : voir plus bas. Code mort retiré : `orderFollow` et
  `orderLeaveFormation` (`actions.js`), le bloc `orders` et `legForm` de `escortSheet`,
  `huntAndPortLines`, `behaviourButtons`, l'option `behaviour` de `huntLines`, l'option
  `sail` de `exitLines`.
- Petites corrections : la section d'un convoi au port s'intitule « Au port : appareillage » ;
  la leçon sur le carburant nomme l'alerte « Carburant bas » ; le profil de montée d'une
  patrouille de Coastal Command n'affiche plus « Aucun raid sur la table » (ni le raid, qui
  n'est pas son affaire), et les bandes du profil ont leur légende (`profile.window`).
- Porte tenue : `node tools/smoke/sheets.mjs --gate`, tableau ci-dessus.

### Lot 4 — l'aide générale en rubriques

- `help.rubrics.<onglet>` : 42 rubriques titrées (100 paragraphes de 560 signes au plus ; le
  plus long en faisait 1 332), chacune avec son ancre. En tête de chaque onglet, la liste des
  titres ; dans les textes, des liens d'une rubrique à l'autre (`[[onglet:ancre|titre]]`).
  Les onglets de l'aide restent en vue quand le texte défile ; l'aide passe à 680 px de large.
- Rubriques nouvelles : « Tracés et ordres sur la carte », « La carte », « Lire une fiche »,
  « Trains et stocks », « Radars et installations », « Rejoindre un convoi », « Repères et
  contacts U-Boot », « Vitesse, zigzag et traînards », « Silence radio », « Achats en
  Amérique », « Le rythme des quarts », « Astuces de première fois ». Les longs paragraphes
  de « Ce scénario » de l'Atlantique (quarts, silence radio) y sont passés ; le scénario en
  garde un résumé et un lien.
- Leçons : leur propre « Ce scénario » (`help.scenario.lecon-*`).
- Touches : Q (rapport de quart), + et − (zoom).
- Images refaites par `tools/smoke/help-images.mjs` (la fiche d'une escadrille en vol, la
  page Effectifs, la fiche d'un groupe d'escorte en mer).
- `tests/help.test.js` : chaque lien de bulle et chaque lien écrit dans l'aide mène à une
  rubrique qui existe, et porte son titre.

### Lot 5 — astuces de première fois et tutoriel

- `src/ui/tips.js` : cinq astuces, chacune à son occasion, une à la fois, dans une petite
  carte en bas à gauche de la carte, au-dessus de l'échelle. Elle est sous la fiche (z-index
  2 contre 3) et à côté d'elle, où que la fiche soit rangée. Après « Compris », rien pendant
  vingt secondes : pas une astuce sur l'autre. La clé `jeu-1940.tips.v1` reprend
  `jeu-1940.scheduleHint.v1`. « Revoir les astuces » dans les Réglages, onglet Carte et fiche.
- Leçon 2 « Tracer et corriger » : scénario `lecon-tracer` (un ciel sans raid, le 32 Sqn),
  dix étapes. L'instructeur fait décoller l'escadrille, le temps s'arrête, puis chaque étape
  attend son geste : tracer, déplacer un carré, glisser un « + », prolonger depuis l'anneau,
  retirer un point, mesurer à la règle, régler l'altitude d'un point. Un geste fait avant son
  étape est redemandé (condition `flagSince`). 171 mots ; l'essai de fumée la joue à la
  souris et la mesure à 3,0 minutes en première lecture.
- Leçons renumérotées (noms, titres des scénarios) ; les textes qui comptaient quatre leçons
  en comptent cinq (menu, aide, fin de la leçon 5, README).
- Station radar mobile : le geste de pose (`mru.hint`, jamais affiché jusqu'ici) s'affiche
  sous le bouton pendant la pose. Voir « Écarts au plan », point 6.
- L'aide jamais ouverte : un point sur le bouton « Aide », jusqu'à la première lecture.
  Voir « Questions », point 3.
- Porte tenue : chaque astuce s'affiche une fois, « Compris » tient après un rechargement,
  aucune pendant une leçon, la carte d'astuce ne passe pas au premier plan, les cinq leçons
  sont jouées de bout en bout à l'essai de fumée.

### Lot 6 — panneau de droite, pages et réglages

- « Cliquez sur une unité… » : seulement tant qu'aucune fiche n'a été ouverte dans ce
  navigateur (une fiche ouverte par une leçon ne compte pas), sans « à droite de la carte ».
- Page Effectifs : les réponses (« Heure non comprise », « Plan copié vers… ») s'écrivent
  dans la page, sous son titre.
- Un « ? » dans le titre des pages Effectifs, Formations, Fiches techniques et Charger, et
  du bloc « Achats en Amérique » ; un « ? » par réglage (huit). La bulle s'ouvre devant la
  page ; Échap ne ferme qu'elle.
- « Prévision de tonnage » et « À décider » : leur phrase en infobulle du titre.
- Les états vides des pages (« Aucun rapport », « Aucun convoi en mer »…) prennent le style
  d'état.

### Lot 7 — vérifier et rendre compte

- Version 2.11.0 (paquet, `src/core/version.js`, README). README mis à jour.
- Relecture par un agent neuf, puis corrections : voir à la fin de ce journal.

## Écarts au plan, et pourquoi

1. **Reprise du réglage « Aides des fiches ».** Le plan veut qu'un joueur qui n'a jamais
   touché au réglage prenne le nouveau défaut, et que celui qui a choisi « Affichées » le
   garde. Or la 2.10 enregistrait le réglage avec tous les autres, qu'on y ait touché ou non :
   rien ne distingue les deux cas. J'ai choisi l'intention principale (l'aide masquée par
   défaut) : les réglages enregistrés avant la 2.11.0 prennent « Masquées » ; depuis, un choix
   fait dans les Réglages est marqué (`sheetHelpChosen`) et gardé. Un joueur de la 2.10 qui
   avait choisi « Repliées » ne voit pas de différence ; celui qui tenait à « Affichées »
   doit le choisir une fois.
2. **« L'état garde la clé actuelle, l'aide en prend une nouvelle. »** Quand la clé actuelle
   se terminait par `Hint` (`orders.dryHint`, `orders.scheduledRouteHint`,
   `sheet.stragglerHint`, `rally.routeHint`…), j'ai donné à l'état un nom juste
   (`orders.dry`, `orders.scheduledNoRoute`, `sheet.straggler`, `rally.routeAfter`) : une
   clé `…Hint` qui porte un état aurait trompé le prochain lecteur. La table donne les deux.
3. **La section « Convois » d'un groupe d'escorte n'apparaît que si elle a quelque chose à
   offrir** (un convoi à rejoindre, un convoi à quitter). Dans le plan, la phrase allait au
   « ? » de la section ; mais sans convoi en mer la section n'aurait plus eu qu'un titre.
   C'est l'origine des −42 px de la fiche au port. En Réaliste, où « Rejoindre » n'est pas
   offert, la règle des 15 km se lit dans l'aide (« Rejoindre un convoi »).
4. **Port sans chenal** (Halifax, Sydney, Douvres…) : la liste « Sortie » n'a rien à
   proposer, elle n'est plus affichée ; la section s'intitule « Au port : appareillage » et
   sa bulle est écrite pour ce cas (`portPlain`).
5. **Infobulles et bulles.** Le plan demande que ce que dit une infobulle figure aussi dans
   la bulle de sa section. C'est le cas partout sauf deux endroits, faute de place dans
   quatre phrases : le format du champ « Fin » n'est pas dans les bulles d'une big wing, d'un
   groupe de soutien et d'un convoi quand on trace à la souris (il y est en ordres par caps,
   et le champ montre ses exemples) ; la barre de commandes n'a pas de « ? », donc le zigzag
   et les traînards d'un convoi sont en infobulle et dans l'aide seulement (la ligne de
   vitesse dit déjà « au mieux 11, avec traînards »).
6. **`mru.hint` n'est pas une sixième astuce.** Le plan en faisait une astuce de première
   fois ; la décision du 20 novembre en fixe cinq au plus. Le geste de pose s'affiche donc
   sous le bouton « Déployer », pendant la pose seulement, et dans l'aide (« Radars et
   installations »).
7. **Textes jamais affichés : 38 clés, pas 17.** Le plan en comptait dix-sept. En cherchant
   toute clé de `fr.json` qu'aucun code ne lit, j'en trouve 38 (des libellés surtout), plus
   les deux à reprendre et `save.details.note`. Trois sont reprises comme prévu
   (`orders.alertHint` est le texte de la bulle « Au sol », `mru.hint`, `profile.window`),
   `save.details.note` est gardée, les 37 autres sont retirées. Liste plus bas.
8. **La leçon 2 dure 3,0 minutes à l'essai, pour « deux à trois ».** Sept gestes à douze
   secondes chacun en font déjà la moitié. Ses textes ont été resserrés de 209 à 171 mots.
9. **Bulle dans les Réglages : pas de texte « affiché ».** « Affichées » écrit le texte des
   bulles dans les fiches et sous le titre des pages. Dans les Réglages, il n'y a que les
   « ? » : c'est la décision 5 (« un « ? » par réglage »), et la page serait redevenue un mur
   de phrases.
10. **La note « Réglages de la partie en cours… » et « Les réglages s'appliquent tout de
    suite… » restent écrites** dans les Réglages : elles disent à qui la page s'applique,
    c'est un état de la page, pas un mode d'emploi.

## Tests existants modifiés

« Un test existant ne s'affaiblit jamais pour passer. » Voici chaque vérification existante
que j'ai dû changer, et pourquoi ; aucune n'a été retirée.

- Essai de fumée, groupe « quarts » (lot 1) : quatre vérifications lisaient la classe
  `.hint.awaited` et l'ancienne phrase ; elles lisent `.state-line.awaited` et la phrase
  d'état raccourcie par le plan. Elles vérifient la même chose : que la ligne est là.
- Essai de fumée, étape « the help of the sheets (C8) » : réécrite pour la bulle, comme le
  plan le demande ; elle vérifie plus qu'avant (huit vérifications au lieu de trois).
- `tests/help.test.js`, premier test : l'aide n'est plus `help.sheet`, `help.air`… mais
  `help.rubrics` ; le test vérifie les rubriques (titre, ancre unique, paragraphes courts).
- `tests/help.test.js` et `tests/scenarios.test.js` : quatre leçons → cinq ; « trois à cinq
  minutes » reste exigé des quatre premières, la nouvelle doit annoncer deux à trois.
- Essai de fumée, tutoriel : « quatre leçons » → cinq ; la durée de la leçon 2 est vérifiée
  entre 2 et 3,5 minutes en première lecture.
- Le test « l'aide parle de la fiche telle qu'elle est (pas d'anciens onglets) » interdit
  les mots « onglet Ordres » dans l'aide. Mon premier texte de « Trains et stocks » les
  employait pour l'onglet Ordres d'une installation (qui existe). Je n'ai pas touché au
  test : j'ai récrit la phrase (« « Envoyer un train », dans la fiche d'un port ou d'un
  dépôt »).

## Table « ancienne clé → nouvelle place »

Toutes les clés de `data/i18n/fr.json` retirées ou récrites par ce chantier. Les textes des
bulles, des infobulles et des astuces cités ici sont donnés en entier dans les tables
suivantes.

| Ancienne clé | Texte (début) | Ce qui reste dans la fiche | Où est allé le reste |
| --- | --- | --- | --- |
| **Partout où l'on trace une route** | | | |
| `orders.drawHint` | Glissez depuis l'unité pour tracer sa route. Sur le tracé : glissez un… | — | 1re phrase de la bulle « Route et étapes » (`sheetHelpLead.route.draw`) ; astuce « Tracer et corriger » (`firstTips.sheet`) ; leçon 2 ; aide « Tracés et ordres sur la carte » |
| `orders.headingsHint` | Mesurez le cap avec la règle (glissez depuis l'unité), puis ajoutez l'… | — | 1re phrase de la bulle « Route et étapes » en ordres par caps (`sheetHelpLead.route.headings`) ; `firstTips.sheet.textHeadings` ; aide « Cap direct et étapes au cap » |
| `orders.followingRoute` | Suit son tracé ({n} point{s}). Glissez un point pour le déplacer, un «… | État : « Suit son tracé · {n} point{s}. » | Le geste : bulle « Route et étapes » |
| `orders.waitingRoute` | Tracé préparé ({n} point{s} après la sortie) : il attend l'appareillag… | État : « Tracé préparé · {n} point{s} : attend l'appareillage. » ; pour une escadrille, `orders.waitingRouteAir` (« … attend le décollage. ») | Le geste : bulle « Route et étapes » |
| `orders.endHintAir`<br>`orders.endHintAirNoGrid`<br>`orders.endHintSea` | Fin : durée (6, 1 h 30), heure (14:20), carré (J5) ou position (51N 1E… | — | Infobulle du champ « Fin » (`tips.legEnd.*`) ; bulles `routeAir` et `routeEscort` ; aide « Cap direct et étapes au cap » |
| `orders.pointHintAir`<br>`orders.pointHintSea` | ↑ ↓ règlent l'altitude que l'escadrille vise en allant vers ce point.… | — | Bulle « Route et étapes » ; infobulle de « Supprimer ce point » (`tips.pointDelete`) ; astuce « Un point choisi » (`firstTips.point`) ; aide « Tracés et ordres sur la carte » |
| `orders.awaitedRoute` | Tracé de {n} point{s} en attente : il part par radio à la relève de {h… | État : « Tracé de {n} point{s} en attente : il part par radio à la relève de {hour} h. » | « En ocre, modifiable » : bulle « Communications », aide « Silence radio » |
| `orders.awaitedRouteShip` | Tracé de {n} point{s} confié à {group} : il sera remis à la rencontre.… | État, sans « Il reste sur la carte, en ocre » | — |
| `orders.awaitedLegs` | En ocre : pas encore transmis. Ces ordres partent par radio à la relèv… | État : « En ocre : transmis à la relève de {hour} h. » | Le reste : bulle « Communications », aide « Silence radio » |
| `orders.exitStepHint`<br>`orders.exitStepHintHeadings` | La sortie attend l'ordre d'appareiller (le bouton, ou l'heure programm… | — | Bulle « Route et étapes » d'un groupe (`sheetHelp.routeEscort`) ; astuce « Au port : la sortie » ; aide « Appareiller » |
| `orders.convoyEnd.hint` | Sans ordre, un convoi s'arrête au bout d'un tracé et attend ; au bout… | — | Bulle « Route et étapes » d'un convoi (`sheetHelp.routeConvoy`) ; aide « Fin de route d'un convoi » |
| `orders.convoyEnd.hintNow` | Le convoi n'a plus rien à suivre : l'ordre choisi ici s'exécute tout d… | — | Infobulle de la liste « Et maintenant » (`tips.convoyEndNow`) ; bulle `routeConvoy` |
| `orders.convoyEnd.autoPort` | Ce tracé passe près de l'entrée de ce chenal et finit vers ce port : s… | État : « Sans autre ordre, le convoi entre de lui-même dans ce port. » | Le reste : bulle `routeConvoy` (dernière phrase), aide « Fin de route d'un convoi » |
| **Escadrilles** | | | |
| `orders.scrambleHint`<br>`orders.scrambleHintHeadings` | Glissez depuis l'aérodrome vers le raid : l'escadrille prête décolle e… | — | Retirée des deux endroits (fiche d'une escadrille, onglet Ordres d'un aérodrome) ; leçon 1 ; bulle `routeAir` ; aide « Intercepter un raid, couvrir un convoi » |
| `orders.scheduleHint`<br>`orders.understood` | Programmer un départ : l'heure saisie est celle de l'ordre. L'unité pa… | — | Astuce de première fois « Programmer un départ » (`firstTips.schedule`, `firstTips.understood`) ; aide « Programmer un départ » |
| `orders.scheduledRouteHint` | Glissez depuis l'aérodrome pour tracer la route : elle attend le décol… | État, seulement sans route ni étapes : « Sans route ni étapes : patrouillera au-dessus de sa base. » (`orders.scheduledNoRoute`) | Le geste : bulles `routeAir` et `groundPlain` |
| `orders.interceptHint` | Le contrôleur guide l'escadrille et la fait monter au-dessus du raid.… | — | Infobulle des boutons « Intercepter » (`tips.intercept`) ; bulle « Mission » ; aide « Intercepter un raid, couvrir un convoi » |
| `orders.coverHint` | L'escadrille tourne au-dessus du convoi et le suit. | — | Infobulle des boutons « Couvrir » (`tips.cover`) ; bulle « Mission » |
| `orders.letGo`<br>`orders.letGoMany` | Désengagée de {raids} : elle laisse ce raid tranquille, quelle que soi… | État : « Désengagée de {raids}. » | La règle : infobulle de « Rompre » (`cmd.breakOffTitle`), bulle « Mission », aide « Face à l'ennemi » |
| `sheet.roleHint.watch`<br>`sheet.roleHint.coastal` | Section de guet : elle ne combat pas. Ce qu'elle voit est plotté avec… | Onglet Fiche technique, au-dessus de la carte de l'avion (`cards.role.*`) | Aide « Intercepter un raid, couvrir un convoi » |
| `unit.memberHintAir`<br>`unit.memberHintSea` | Les ordres se donnent à la formation : elle décolle, vole et rentre en… | État : « Ordres : par {name}. » (`unit.ordersVia`), avec « Voir la formation » | Bulles « Formation » et « Groupe de soutien » ; aide « Formations » |
| **Convois** | | | |
| `orders.sailHint` | Le convoi attend au port : préparez ses étapes, puis donnez l'ordre d'… | — | Supprimée de la fiche (doublon). L'infobulle d'« Appareiller » dit son action (`tips.sailConvoy`) |
| `orders.sailScheduledHint` | Tracez la route depuis le port, ou préparez des étapes : elles attende… | — | Bulle « Au port : appareillage » (`sheetHelp.convoyPort`) ; aide « Appareiller » |
| `orders.speedHint` | Au maximum, des navires lents décrochent et deviennent des traînards.… | — | Infobulle de la vitesse maximale d'un convoi (`tips.boostConvoy`) et du zigzag (`tips.zigzagOn`, `tips.zigzagOff`) ; aide « Vitesse, zigzag et traînards » |
| `orders.zigzagOn`<br>`orders.zigzagOff` | Zigzag : oui | — | `tips.zigzagOn`, `tips.zigzagOff` |
| `sheet.stragglerHint` | Un navire tombé derrière son convoi : seul, sans escorte, une proie fa… | État : « Traînard : seul, sans escorte. » (`sheet.straggler`) | Aide « Vitesse, zigzag et traînards » |
| **Groupes d'escorte et groupes de soutien** | | | |
| `orders.exitHint` | Choisir une sortie en fait la première étape du groupe : elle se dessi… | — | Bulle « Au port : sortie et appareillage » (`sheetHelp.port`) ; infobulle d'« Appareiller » réduite à son action (`tips.sailEscort`) ; aide « Appareiller » |
| `orders.exitHintNoChannel` | Appareiller : le groupe sort au large du port et y attend vos ordres,… | — | Infobulle d'« Appareiller » dans un port sans chenal (`tips.sailEscortNoChannel`) ; bulle `portPlain` |
| `orders.sailScheduledHintEscort` | À l'heure dite, le groupe appareille avec ce qui est préparé : sa sort… | — | Bulle « Au port » ; aide « Programmer un départ » |
| `orders.joinHint` | Le groupe prend station dès qu'il est à moins de 15 km d'un convoi. «… | — | Bulle « Convois » ; infobulle de « Rejoindre … » (`tips.join`) ; aide « Rejoindre un convoi » |
| `orders.behaviourHint`<br>`orders.behaviours.stay`<br>`orders.behaviours.hunt` | Rester : le groupe garde son poste et n'attaque qu'un U-Boot qu'il peu… | — | Une phrase par bouton, barre de commandes (`tips.behaviour.stay`, `tips.behaviour.hunt`) ; bulle « Chasse aux U-Boote » ; aide « Chasse aux U-Boote » |
| `orders.patternHint` | Grenadage plein : dix grenades par passe. Économe : cinq, avec moins d… | — | Bulle « Chasse aux U-Boote » (les passes à blanc) ; les infobulles de « Plein » et « Économe » existaient ; aide « Chasse aux U-Boote » |
| `orders.dryHint` | Plus de mazout : le groupe rentre au port le plus proche, à {kn} nœuds… | Alerte raccourcie (`orders.dry`) : « À sec : rentre au port le plus proche, {kn} nœuds au plus. Seul le port peut changer. » | — |
| `comms.channel.radio` | En haute mer, sous silence radio : la position est une estimation, et… | État raccourci : « En haute mer, sous silence radio : position estimée, ordres par radio à la relève de {hour} h. » | Le B-Dienst : bulle « Communications », aide « Silence radio » |
| `comms.askPositionHint` | Le navire répond par radio à la relève de {hour} h : un point sûr pour… | — | Infobulle de « Demander la position » (`tips.askPosition`) ; bulle « Communications » |
| `unit.groupHint` | Tracez la route depuis le groupe de soutien : ses groupes suivent le c… | — | Bulles « Gérer la formation » (`sheetHelp.manageSea`) et `routeGroup` ; aide « Formations » |
| **Big wings et rassemblements** | | | |
| `unit.wingHintGround`<br>`unit.wingHintAir`<br>`unit.wingHintGroundHeadings`<br>`unit.wingHintAirHeadings` | Glissez depuis le chef (ou son aérodrome) pour tracer la route de la f… | — | Bulle « Route et étapes » d'une big wing (`sheetHelp.routeWing`) ; aide « Formations » |
| `rally.routeHint` | Route après le rendez-vous : glissez depuis le point RV sur la carte (… | État : « Route après le rendez-vous : {n} point{s}. » ou « Pas de route après le rendez-vous : la formation tournera au-dessus du point. » (`rally.routeAfter`, `rally.routeNone`) | Le geste : bulle « Lieu du rassemblement », aide « Rassemblement » |
| `rally.timeSet` | Rendez-vous à {time} : la formation part à cette heure ; les premiers… | État : « Rendez-vous à {time}. » | Le reste : bulle « Lieu du rassemblement » |
| `rally.missingHintAir`<br>`rally.missingHintSea` | Au rendez-vous, s'il manque une escadrille, la question vous est posée… | — | Bulle « Lieu du rassemblement » ; une infobulle par bouton (`tips.missing.wait`, `.slow`, `.go`) |
| `rally.leaderHint`<br>`rally.leaderHintSea` | Sur le chef : les membres décollent à leur heure et rejoignent le chef… | — | Bulle « Lieu du rassemblement » ; infobulle de « Sur le chef » (`tips.rallyLeaderAir`, `tips.rallyLeaderSea`) et de « Sur un point » (`tips.rallyPoint`) |
| `rally.aid.auto`<br>`rally.aid.eta`<br>`rally.aid.none` | Arcade : les départs sont calculés pour que tous arrivent ensemble. | — | Dernière phrase de la bulle « Lieu du rassemblement », selon l'aide à l'interception (`sheetHelpLead.rally.*`) |
| `unit.mergeHint` | Toutes les unités de l'autre formation rejoignent celle-ci, à la suite… | — | Infobulle des boutons « Prendre … » (`tips.merge`) ; bulles « Gérer la formation » |
| **Installations, contacts et panneau de droite** | | | |
| `logistics.minHint` | Ordre permanent : quand le stock (trains en route compris) passe sous… | — | Infobulle du champ (`tips.minStock`) ; bulle « Stock minimum » |
| `logistics.minAuto` | Arcade : seuil automatique de {n} t. | — | Supprimée : le champ montre le seuil en grisé. En Arcade, l'infobulle du champ le dit (`tips.minStockAuto`) |
| `logistics.trainHint` | Un train compte au plus {wagons} wagons : citernes de {fuel} t pour le… | — | Infobulle des champs de chargement (`tips.trainLoad`) ; bulle « Envoyer un train » |
| `logistics.perAircraft` | {n} t de matériel par avion | Ligne du tableau : « Matériel par avion · 8 t » | — |
| `sheet.detectedAt` | Détecté à {time} | Ligne du tableau : « Détecté · 12:02 » | — |
| `sheet.uplotHint` | Les deux cercles grandissent avec l'âge du plot : en tirets, ce que le… | Légende : « Tirets : en surface · pointillé : en plongée. » (`sheet.uplotLegend`) | Les vitesses : aide « Repères et contacts U-Boot » |
| `sheet.ucontactHint` | Le U-Boot est suivi tant qu'il reste en vue ou au contact de l'ASDIC.… | — | Aide « Repères et contacts U-Boot » |
| `panel.hint`<br>`panel.hintHeadings` | Cliquez sur une unité ou une installation pour ouvrir sa fiche à droit… | Seulement tant qu'aucune fiche n'a été ouverte ; sans « à droite de la carte » | « Revoir les astuces » la fait revenir |
| `offers.intro` | Avant le prêt-bail, la Grande-Bretagne paie comptant. Les convois part… | — | Bulle du « ? » de « Achats en Amérique » (`sheetHelp.offers`) ; aide « Achats en Amérique » |
| `offers.forecastHint`<br>`offers.forecastHintLend` | Sans compter les pertes à venir, ni un éventuel prêt-bail. « Achetable… | — | Infobulle du titre « Prévision de tonnage » (`tips.forecast`, `tips.forecastLend`) ; aide « Achats en Amérique » |
| **Ailleurs à l'écran** | | | |
| `roster.intro` | Choisissez un aérodrome, puis réglez chaque escadrille : son état main… | — | Bulle du « ? » du titre de la page Effectifs (`sheetHelp.roster`) ; aide « La page Effectifs » |
| `formations.intro.air`<br>`formations.intro.naval` | Une big wing est une seule unité : une fiche, les mêmes ordres pour to… | — | Bulle du « ? » du titre de la page Formations (`sheetHelp.formationsAir`, `.formationsNaval`) |
| `cards.intro` | Les chiffres que le jeu utilise, proches de ceux de l'époque. Le plafo… | — | Bulle du « ? » du titre de la page Fiches techniques (`sheetHelp.cards`) |
| `watch.decideHint` | Une décision laissée de côté reste dans les rapports suivants, sans ar… | — | Infobulle du titre « À décider » (`tips.decide`) ; aide « Le rythme des quarts » |
| `watch.decide.marker` | {convoy} : {n} repère(s) U-Boot sur sa route dans les 24 heures ({plot… | Sans la parenthèse du geste : « … Changer de route, ou la garder. » | — |
| `settings.seaCommsHint`<br>`settings.watchStopsHint`<br>`settings.alertSpeedsHint`<br>`settings.sheetHint`<br>`settings.sheetHelpHint`<br>`settings.viewZonesHint`<br>`settings.devHint` | Silence radio (dans l'Atlantique) : hors des eaux suivies — eaux fermé… | — | Un « ? » par réglage (`sheetHelp.setSeaComms`, `.setWatchStops`, `.setAlertSpeeds`, `.setSheetPos`, `.setSheetHelp`, `.setViewZones`, `.setDev`) |
| `menu.loadIntro` | La partie en cours, ses cinq dernières sauvegardes automatiques (une p… | — | Bulle du « ? » du titre de la page Charger (`sheetHelp.load`) |
| `sheet.helpToggle` | Aide de cette section | — | Remplacée par `help.mark` (« Aide », le nom du « ? ») |
| `help.sheet`<br>`help.air`<br>`help.sea`<br>`help.time`<br>`help.games`<br>`help.keys` | La fiche d'une unité s'ouvre quand on clique l'unité, sur la carte ou… | — | `help.rubrics.<onglet>` : les mêmes textes, coupés en 42 rubriques titrées |
| `unit.stackTab`<br>`unit.siteTab` | {name} : ouvrir sa fiche (les unités superposées sur la carte ont chac… | Infobulle d'un onglet de pile, sans sa parenthèse | L'explication : aide « Unités superposées » |
| `cmd.breakOffTitle` | Désengager {raid} (D) : sortir du combat, tourner sur place et laisser… | Infobulle de « Rompre », avec la règle : « … et laisser ce raid tranquille jusqu'à un nouvel ordre sur lui » | — |
| `profile.window` | zone de combat possible | Légende des bandes du profil de montée (jamais affichée jusqu'ici) : « combat possible : avec l'avantage (vert), sans (ocre) » | — |

Inchangées, mais passées du style d'aide au style d'état (lot 1) : `orders.followingUntilRelief`,
`orders.noLeg`, `orders.noLegReady`, `orders.awaitedLand` (alerte), `orders.convoyEnd.intoPort`,
`orders.convoyEnd.intoPortVia`, `orders.convoyEnd.waiting`, `orders.alertNow`,
`orders.manualNow`, `orders.recall`, `orders.sailJoin`, `orders.chargesSpare` et ses sœurs,
`comms.channel.direct`, `comms.channel.lamp`, `rally.underWay`, `sheet.noneHere`,
`sheet.noAttack`, `logistics.unloading`, `offers.congress` (alerte), `offers.lendLease`,
`orders.rosterOverrideUntil` et ses sœurs, `formations.startHint.*`, `formations.total.*`,
`formations.addMore`, `cards.notes.*`, `reports.none`, `reports.noSquadron`,
`reports.naval.noPass`, `watch.convoysNone`, `watch.signalsNone`, `watch.none`,
`watch.noneFiltered`.

Récrites pour d'autres raisons : `settings.sheetHelpChoices.folded` (« Masquées (un « ? » par
section) »), `help.steps` et `help.scenario.hiver-atlantique` (résumé et lien vers la
rubrique), `help.images.sheet` et `help.images.escort` (légendes des images refaites), les
noms des leçons et les titres de leurs scénarios (renumérotés), la fin des leçons 1 et 5,
`tutorial.lessons.supply.steps.base.text` (« Carburant bas »), `menu.trainingText`,
`menu.trainingFirst`, `menu.trainingIntro` (cinq leçons).

## Textes des bulles (à relire)

Une bulle tient en deux à quatre phrases (`tests/sheethelp.test.js` le vérifie pour chaque
réglage du jeu), puis vient son lien « Plus dans l'aide : « rubrique » ».

| Bulle | Où | Texte | Lien « Plus dans l'aide » |
| --- | --- | --- | --- |
| `ground` | Fiche d'une escadrille ou d'une big wing, section « Au sol » (avec la fatigue) | Le délai d'un état d'alerte, c'est le temps pour être en l'air après l'ordre de décoller. Monter d'un cran prend la différence (du repos à l'alerte : 1 h 55) ; descendre est immédiat. Seul le Repos repose vraiment : Disponible repose peu, l'Alerte fatigue un peu, le Cockpit davantage. Un départ programmé donne l'ordre à l'heure saisie : l'escadrille part ensuite selon son état. | Air · « États d'alerte » |
| `groundPlain` | La même section, sans la fatigue | « Programmer » donne l'ordre de décoller à l'heure saisie, une fois ou chaque jour. Tracez la route depuis l'aérodrome, ou préparez des étapes : elles attendent le décollage. Sans route ni étapes, l'escadrille patrouille au-dessus de sa base. | Air · « Programmer un départ » |
| `routeAir` | Escadrille, section « Route et étapes » | Un point choisi se règle avec ↑ ↓ : c'est l'altitude que l'escadrille vise en y allant. Une étape au cap se donne sous « Nouvelle étape » : un cap, puis une fin (durée, heure, carré ou position) ; sans fin, elle dure jusqu'à nouvel ordre. Au sol, une route tracée depuis l'aérodrome fait décoller l'escadrille prête ; avec un départ programmé, elle attend l'heure. *(précédé de la phrase du tracé, ci-dessous)* | La fiche · « Tracés et ordres sur la carte » |
| `routeWing` | Big wing, section « Route et étapes » | Toutes les escadrilles de la formation suivent la route du chef, à la vitesse de la plus lente. Décollée ensemble, elle se rassemble au-dessus du chef avant de partir. Un point choisi se règle avec ↑ ↓ : c'est l'altitude visée en y allant. *(précédé de la phrase du tracé, ci-dessous)* | Air · « Formations : big wing et groupe de soutien » |
| `routeEscort` | Groupe d'escorte, section « Route et étapes » | Au port, la sortie choisie est la première étape du groupe : elle attend « Appareiller » ou l'heure programmée, et se prolonge depuis l'anneau à son bout ou par des étapes au cap. Une étape au cap prend une fin (durée, heure ou position) ; sans fin, elle dure jusqu'à nouvel ordre. La liste de fin de route dit ce que le groupe fait ensuite : attendre, garder le cap, rejoindre un convoi, chasser ou entrer dans un port. *(précédé de la phrase du tracé, ci-dessous)* | Mer · « Appareiller » |
| `routeGroup` | Groupe de soutien, section « Route et étapes » | Les groupes du groupe de soutien suivent le chef en ligne de file. Au port, la sortie choisie est leur première étape : elle attend « Appareiller » ou l'heure programmée. Quand le plus court arrive au bout de son autonomie, tous rentrent. *(précédé de la phrase du tracé, ci-dessous)* | Air · « Formations : big wing et groupe de soutien » |
| `routeConvoy` | Convoi, section « Route et étapes » | Sans ordre, un convoi s'arrête au bout d'un tracé et attend ; au bout de ses étapes, il garde le cap. La liste de fin de route en décide autrement, tout de suite s'il n'a plus rien à suivre : « Entrer à… » le mène par le large à l'entrée du chenal choisi, où le pilote monte à bord ; « Reprendre la route de l'Amirauté » la rejoint au prochain point devant lui. Un tracé qui passe près de l'entrée d'un chenal et finit vers son port y entre de lui-même. *(précédé de la phrase du tracé, ci-dessous)* | Mer · « Fin de route d'un convoi » |
| `mission` | Escadrille ou big wing, section « Mission » | « Couvrir » fait tourner l'escadrille au-dessus du convoi, qu'elle suit. En Arcade, « Intercepter » laisse le contrôleur la guider et la faire monter au-dessus du raid ; sa chance dépend de la couverture radar au point de rencontre. « Rompre », dans la barre de commandes, la désengage d'un raid : elle le laisse tranquille, quelle que soit son attitude, jusqu'à un nouvel ordre sur lui. | Air · « Face à l'ennemi » |
| `formation` | Escadrille, section « Formation » | Une big wing est une seule unité : les ordres se donnent à la formation, qui décolle, vole et rentre ensemble. Chaque escadrille garde son état d'alerte et peut partir à sa propre heure. | Air · « Formations : big wing et groupe de soutien » |
| `group` | Groupe d'escorte, section « Groupe de soutien » | Un groupe de soutien réunit des groupes d'escorte : les ordres se donnent au groupe de soutien, dont les groupes appareillent, escortent et rentrent ensemble. Quand le plus court arrive au bout de son autonomie, tous rentrent. | Air · « Formations : big wing et groupe de soutien » |
| `manageAir` | Big wing, section « Gérer la formation » | Une big wing est une seule unité : une fiche, les mêmes ordres pour toutes ses escadrilles. Une escadrille à court d'essence ou de munitions la quitte et rentre ; le chef suivant prend la tête. « Composer… » ouvre la page Formations, pour ajouter une escadrille ou changer de chef ; « Dissoudre » rend à chacune ses propres ordres. Dans l'onglet Membres, « Prendre… » fait passer ici toutes les escadrilles d'une autre big wing. | Air · « Formations : big wing et groupe de soutien » |
| `manageSea` | Groupe de soutien, section « Gérer la formation » | Tracez la route depuis le groupe de soutien : ses groupes suivent le chef en ligne de file. Quand le plus court arrive au bout de son autonomie, tous rentrent. « Composer… » ouvre la page Formations ; « Dissoudre » rend à chaque groupe ses propres ordres. Dans l'onglet Membres, « Prendre… » fait passer ici tous les groupes d'un autre groupe de soutien. | Air · « Formations : big wing et groupe de soutien » |
| `convoyPort` | Convoi au port, section « Au port : appareillage » | Un tracé tiré depuis le port fait appareiller le convoi tout de suite. Des étapes préparées attendent « Appareiller », dans la barre de commandes. Avec un appareillage programmé, tracé et étapes attendent l'heure dite. Sans rien de préparé à cette heure, le convoi n'a nulle part où aller, et l'ordre attend. | Mer · « Appareiller » |
| `port` | Groupe d'escorte au port, section « Au port : sortie et appareillage » | Choisir une sortie en fait la première étape du groupe : en rade, ou par un chenal jusqu'au large. Elle attend « Appareiller » ou l'heure programmée ; sans sortie choisie, un tracé tiré depuis le port part tout de suite. À l'heure dite, le groupe appareille avec ce qui est préparé, ou sort en rade et y attend vos ordres s'il n'y a rien. | Mer · « Appareiller » |
| `portPlain` | Groupe d'escorte dans un port sans chenal, section « Au port : appareillage » | « Appareiller » fait sortir le groupe au large du port, où il attend vos ordres. Un tracé tiré depuis le port part tout de suite. Avec un appareillage programmé, tracé et étapes attendent l'heure dite. | Mer · « Appareiller » |
| `comms` | Navire en mer, section « Communications (silence radio) » | En haute mer, sous silence radio, la position d'un navire est une estimation et vos ordres partent par radio à la relève suivante. D'ici là ils restent sur la carte, en ocre, et se modifient encore. Une route envoyée par radio peut être lue par le B-Dienst ; au projecteur d'un avion en vue, ou portée par un groupe d'escorte, elle ne l'est pas. « Demander la position » fait répondre le navire à la relève : un point sûr pour vous, un relèvement pour les U-Boote. | Mer · « Silence radio » |
| `convoys` | Groupe d'escorte, section « Convois » | Le groupe prend station dès qu'il est à moins de 15 km d'un convoi. « Rejoindre » calcule lui-même la route d'interception (sauf en Réaliste) et contourne la terre ; « Rentrer au port » aussi. Une route tracée qui finit dans la bulle d'un port y entre. | Mer · « Rejoindre un convoi » |
| `uboats` | Groupe d'escorte, section « Chasse aux U-Boote » | Rester : le groupe garde son poste et n'attaque qu'un U-Boot qu'il peut rejoindre sans lâcher son convoi (30 min et 15 km au plus). Chasser : il quitte le convoi pour un contact frais et revient seul, U-Boot coulé, contact perdu ou grenades tombées au tiers gardé pour le convoi ; le convoi reste sans escorte pendant ce temps. Grenadage plein : dix grenades par passe ; économe : cinq, avec moins de chances mais deux fois plus de passes. À vide, le groupe passe encore, à blanc : le U-Boot reste en plongée et perd le convoi. | Mer · « Chasse aux U-Boote » |
| `rallyAir` | Big wing, onglet Rassemblement, « Lieu du rassemblement » | Sur le chef : les membres décollent à leur heure et rejoignent le chef, qui les attend au-dessus de sa base (15 min au plus). Sur un point : avec une heure de rendez-vous, la formation part à cette heure et les premiers arrivés l'attendent ; pour la route d'après, glissez depuis le point RV sur la carte. S'il manque une escadrille à l'heure, la question vous est posée : attendre (pas plus que le délai saisi), partir lentement pour être rattrapé, ou partir sans elle ; sans réponse, le choix fait ici s'applique. *(suivi de la phrase de l'aide au rassemblement, ci-dessous)* | Air · « Rassemblement » |
| `rallySea` | Groupe de soutien, onglet Rassemblement, « Lieu du rassemblement » | Sur le chef : le chef appareille à son heure avec ses propres ordres ; chaque groupe appareille à la sienne, le rejoint en mer et prend son poste. Sur un point : avec une heure de rendez-vous, le groupe de soutien part à cette heure et les premiers arrivés l'attendent ; pour la route d'après, glissez depuis le point RV sur la carte. S'il manque un groupe à l'heure, le choix fait ici s'applique : attendre (pas plus que le délai saisi), partir lentement pour être rattrapé, ou partir sans lui. *(suivi de la phrase de l'aide au rassemblement, ci-dessous)* | Air · « Rassemblement » |
| `minStock` | Aérodrome ou usine, onglet Ordres, « Stock minimum » | Le stock minimum est un ordre permanent : quand le stock (trains en route compris) passe sous ce seuil, un train part du port le mieux placé. Champ vide : pas d'ordre. En Arcade, le seuil est automatique. | Air · « Trains et stocks » |
| `train` | Port ou dépôt, onglet Ordres, « Envoyer un train » | Un train compte au plus {wagons} wagons : citernes de {fuel} t pour le carburant, wagons couverts de {materiel} t pour le reste. Il lui faut au moins {min} t. Un petit train prend quand même un des trains de la ligne. | Air · « Trains et stocks » |
| `offers` | Panneau de droite, onglet Logistique, « Achats en Amérique » | Avant le prêt-bail, la Grande-Bretagne paie comptant. Les convois partent chargés à plein tant que la réserve le permet ; ce qu'elle ne peut plus payer part sur lest. | Mer · « Achats en Amérique » |
| `roster` | Page Effectifs, titre | Choisissez un aérodrome, puis réglez chaque escadrille : son état maintenant, son plan de chaque jour (de 00:00 à 24:00, il se répète) ou, case cochée, un plan d'exception pour les prochaines {n} h en heures H. Un état choisi à la main garde la main jusqu'à « Retour au planning ». | Air · « La page Effectifs » |
| `formationsAir` | Page Formations, titre (big wings) | Une big wing est une seule unité : une fiche, les mêmes ordres pour toutes ses escadrilles. Elle décolle ensemble, se rassemble au-dessus de son chef, puis vole à la vitesse de la plus lente. Une escadrille à court d'essence ou de munitions la quitte et rentre ; le chef suivant (★) prend la tête. | Air · « Formations : big wing et groupe de soutien » |
| `formationsNaval` | Page Formations, titre (groupes de soutien) | Un groupe de soutien réunit des groupes d'escorte : ils appareillent, escortent et chassent ensemble. Quand le plus court d'entre eux arrive au bout de son autonomie, tout le groupe rentre au port. | Air · « Formations : big wing et groupe de soutien » |
| `cards` | Page Fiches techniques, titre | Les chiffres que le jeu utilise, proches de ceux de l'époque. Le plafond limite l'altitude qu'on peut ordonner. | Air · « Formations : big wing et groupe de soutien » |
| `load` | Menu principal, page Charger, titre | La partie en cours, ses cinq dernières sauvegardes automatiques (une par jour de jeu, toutes les deux heures de jeu dans une bataille d'une journée), la dernière de chacune des parties d'avant (cinq au plus) et vos sauvegardes manuelles. Charger une sauvegarde remplace la partie en cours, qui est d'abord gardée parmi les sauvegardes automatiques. | Parties et réglages · « Sauvegardes » |
| `setSeaComms` | Réglages, « Communications en mer » | Silence radio (dans l'Atlantique) : hors des eaux suivies — eaux fermées aux U-Boote, approches des ports, couverture des radars côtiers — vos navires ne sont vus que par estimation. Un ordre part par radio à la relève suivante, au projecteur si un de vos avions est en vue, ou confié à un groupe qui rejoint le convoi. | Mer · « Silence radio » |
| `setWatchStops` | Réglages, « Arrêt aux relèves » | Dans l'Atlantique, un rapport s'écrit à chaque relève de quart (0, 4, 8, 12, 16 et 20 h), que le jeu s'arrête ou non : onglet « Signaux » du journal. Entre deux relèves, le jeu ne s'arrête que pour la première attaque d'un convoi dans la nuit. | Temps et alertes · « Le rythme des quarts » |
| `setAlertSpeeds` | Réglages, « Vitesse du jeu à chaque alerte » | Avec « Ralentir le temps à chaque alerte », chaque alerte ramène le jeu au plus à la vitesse choisie ici. En mer, tout passe à ×1 par défaut : on décide, puis on accélère soi-même. | Temps et alertes · « Les alertes ralentissent le temps » |
| `setSheetPos` | Réglages, « Fiche d'unité » | Tirez le bord de la fiche pour l'élargir (ou la grandir en bas). Ses sections se replient d'un clic sur leur titre et restent comme vous les laissez. | La fiche · « Place et taille de la fiche » |
| `setSheetHelp` | Réglages, « Aides des fiches » | Masquées, les aides d'une fiche s'ouvrent section par section avec le « ? ». Affichées, leur texte reste écrit sous le titre de chaque section : utile pour débuter. | La fiche · « Lire une fiche » |
| `setTips` | Réglages, « Revoir les astuces » | Cinq astuces courtes s'affichent au coin de la carte, chacune la première fois qu'elle sert, jamais pendant une leçon. « Revoir les astuces » les fait revenir, chacune à son occasion ; la phrase « Cliquez sur une unité… » du panneau de droite revient aussi. | Parties et réglages · « Astuces de première fois » |
| `setViewZones` | Réglages, « Zones de vue des unités » | Ce que voient les unités, de jour ou de nuit. Un avion : son rayon de vue sur les autres avions (à même altitude ; de bien plus haut ou plus bas, moitié moins loin) et, pour une patrouille côtière, sur un U-Boot en surface. Un groupe d'escorte : un U-Boot en surface (vigies, radar s'il en a) et en plongée (ASDIC). | Mer · « Repères et contacts U-Boot » |
| `setDev` | Réglages, « Mode développeur » | Pour contrôler les scénarios : les vraies positions ennemies en magenta et un onglet « Ennemis ». Il ne change rien à la partie. Le cocher demande le mot de passe. | Parties et réglages · « Réglages de la partie, réglages du joueur » |

Les phrases qui dépendent d'un réglage :

| Phrase | Quand | Texte |
| --- | --- | --- |
| `sheetHelpLead.route.draw` | Début d'une bulle « Route et étapes », ordres par tracé | Glissez depuis l'unité pour tracer sa route ; sur le tracé, glissez un point pour le déplacer, un « + » pour en ajouter, l'anneau du bout pour prolonger, et double-cliquez un point (ou Suppr) pour le retirer. |
| `sheetHelpLead.route.headings` | La même, en ordres par caps (Réaliste) | En ordres par caps, la route se donne en étapes : mesurez le cap à la règle (glissez depuis l'unité), puis ajoutez l'étape mesurée ou tapez-la sous « Nouvelle étape ». |
| `sheetHelpLead.rally.auto` | Fin de la bulle du rassemblement, en Arcade | Les départs sont calculés pour que tous arrivent ensemble. |
| `sheetHelpLead.rally.default` | En Standard | L'heure d'arrivée de chacun s'affiche selon son départ ; sans heure, il part au lancement du plan. |
| `sheetHelpLead.rally.none` | En Réaliste | À vous de compter le délai de décollage, la montée et le trajet (règle, profil) ; sans heure, un membre part au lancement du plan. |

## Infobulles (à relire)

Une ligne chacune (200 signes et deux phrases au plus, vérifié).

| Infobulle | Texte |
| --- | --- |
| `tips.legEnd.air` | Fin de l'étape : une durée (6, 1 h 30), une heure (14:20), un carré (J5) ou une position (51N 1E). Vide : jusqu'à nouvel ordre. |
| `tips.legEnd.airNoGrid` | Fin de l'étape : une durée (6, 1 h 30), une heure (14:20) ou une position (56N 12O). Vide : jusqu'à nouvel ordre. |
| `tips.legEnd.sea` | Fin de l'étape : une durée en heures (30, 6 min), une heure (14:20) ou une position (56N 12O). Vide : jusqu'à nouvel ordre. |
| `tips.pointDelete` | Retirer ce point du tracé (Suppr, ou double-clic sur le point) |
| `tips.convoyEndNow` | Le convoi n'a plus rien à suivre : l'ordre choisi ici s'exécute tout de suite. |
| `tips.intercept` | Le contrôleur guide l'escadrille et la fait monter au-dessus du raid ; la chance affichée dépend de la couverture au point de rencontre. |
| `tips.cover` | L'escadrille tourne au-dessus du convoi et le suit. |
| `tips.sailConvoy` | Appareiller avec les étapes préparées. Sans étape, tirez un tracé depuis le port : le convoi part aussitôt. |
| `tips.sailEscort` | Appareiller : le groupe prend la sortie choisie, puis son tracé ou ses étapes. Sans sortie choisie, il sort en rade et y attend vos ordres. |
| `tips.sailEscortNoChannel` | Appareiller : le groupe sort au large du port et y attend vos ordres, ou prend votre tracé ou vos étapes. |
| `tips.behaviour.stay` | Rester : le groupe garde son poste et n'attaque qu'un U-Boot qu'il peut rejoindre sans lâcher son convoi (30 min et 15 km au plus). |
| `tips.behaviour.hunt` | Chasser : le groupe quitte le convoi pour un contact frais et revient seul. Le convoi reste sans escorte pendant ce temps. |
| `tips.join` | Rejoindre : le groupe calcule sa route d'interception, contourne la terre et prend station à moins de 15 km du convoi. |
| `tips.askPosition` | Le navire répond par radio à la relève de {hour} h : un point sûr pour vous, mais aussi un relèvement pour le commandement des U-Boote. |
| `tips.merge` | Toutes les unités de l'autre formation rejoignent celle-ci, à la suite. |
| `tips.rallyLeaderAir` | Les membres décollent à leur heure et rejoignent le chef, qui les attend au-dessus de sa base (15 min au plus). |
| `tips.rallyLeaderSea` | Le chef appareille à son heure avec ses propres ordres ; chaque groupe le rejoint en mer et prend son poste. |
| `tips.rallyPoint` | Tous se retrouvent sur un point de la carte, à une heure fixée ou au plus tôt. |
| `tips.missing.wait` | Attendre le retardataire au rendez-vous, pas plus longtemps que le délai saisi. |
| `tips.missing.slow` | Partir à l'heure, mais lentement : le retardataire rattrape la formation en route. |
| `tips.missing.go` | Partir à l'heure sans lui : le retardataire suit le plan en retard. |
| `tips.zigzagOn` | Zigzag : oui. Il gêne les U-Boote, mais ralentit le convoi d'environ 15 %. |
| `tips.zigzagOff` | Zigzag : non. Le zigzag gêne les U-Boote, mais ralentit le convoi d'environ 15 %. |
| `tips.boostConvoy` | Vitesse maximale ({best} nœuds) : des navires lents décrochent et deviennent des traînards. À {n} nœuds ou moins, le convoi reste groupé. |
| `tips.minStock` | Ordre permanent : quand le stock (trains en route compris) passe sous ce seuil, un train part du port le mieux placé. Vide : pas d'ordre. |
| `tips.minStockAuto` | En Arcade, le seuil est automatique : il s'affiche en grisé. Un seuil saisi ici le remplace. |
| `tips.trainLoad` | Au plus {wagons} wagons par train : citernes de {fuel} t pour le carburant, wagons couverts de {materiel} t pour le reste. Au moins {min} t par train. |
| `tips.forecast` | Sans compter les pertes à venir, ni un éventuel prêt-bail. « Achetables » : les convois qui peuvent encore arriver avant la fin, payés avec la réserve. |
| `tips.forecastLend` | Sans compter les pertes à venir. Les convois qui peuvent encore arriver avant la fin partent chargés à plein. |
| `tips.decide` | Une décision laissée de côté reste dans les rapports suivants, sans arrêter le jeu une seconde fois. |
| `cmd.breakOffTitle` | Rompre {raid} (D) : sortir du combat, tourner sur place et laisser ce raid tranquille jusqu'à un nouvel ordre sur lui |

## Astuces de première fois (à relire)

Bouton « Compris », et un lien « Plus dans l'aide » vers la rubrique.

| Astuce | Occasion | Titre | Texte |
| --- | --- | --- | --- |
| `firstTips.sheet.text` | La première fiche d'une unité qui se déplace | Tracer et corriger | Glissez depuis l'unité pour tracer sa route. Sur le tracé, glissez un carré pour le déplacer, un « + » pour ajouter un point, l'anneau du bout pour prolonger. |
| `firstTips.sheet.textHeadings` | La première fiche d'une unité qui se déplace (ordres par caps) | Tracer et corriger | En ordres par caps, glissez depuis l'unité pour mesurer un cap à la règle, puis ajoutez l'étape mesurée (Entrée) : la route se donne en étapes. |
| `firstTips.point.text` | Le premier point choisi sur un tracé | Un point choisi | ↑ ↓ règlent l'altitude que l'escadrille vise en allant vers ce point. Suppr, ou un double-clic sur le carré, le retire. |
| `firstTips.point.textSea` | Le premier point choisi sur un tracé (navire) | Un point choisi | Glissez le carré pour déplacer ce point. Suppr, ou un double-clic sur le carré, le retire. |
| `firstTips.exit.text` | Le premier groupe d'escorte au port (port à chenaux) | Au port : la sortie | La sortie choisie devient la première étape du groupe : elle attend « Appareiller » ou l'heure programmée, et se prolonge depuis l'anneau à son bout. |
| `firstTips.silence.text` | Le premier navire en haute mer sous silence radio | Silence radio | En haute mer, la position de ce navire est une estimation. Vos ordres partent par radio à la relève suivante : d'ici là ils restent sur la carte, en ocre, et se modifient encore. |
| `firstTips.schedule.text` | Le premier départ programmé | Programmer un départ | L'heure saisie est celle de l'ordre. L'unité part ensuite selon son état : 2 min au cockpit, 5 min en alerte, 30 min disponible, 2 h au repos. Anticipez l'état d'alerte, ou programmez-le dans les effectifs. |

## La leçon 2, « Tracer et corriger » (à relire)

| Étape | Titre | Texte |
| --- | --- | --- |
| `welcome` | Tracer et corriger | Une route se trace à la souris, puis se corrige sur la carte. L'instructeur fait d'abord décoller le 32 Sqn. |
| `takeoff` | Décollage | Dès que le 32 Sqn est en l'air, le temps s'arrête : à vous. |
| `draw` | Tracer | Glissez depuis l'escadrille jusqu'où vous voulez l'envoyer, puis relâchez : ce trait est sa route. |
| `move` | Déplacer un point | Glissez un carré de la route pour le déplacer. |
| `insert` | Ajouter un point | Glissez un « + », au milieu d'un trait : un point de plus. |
| `extend` | Prolonger | Glissez depuis l'anneau, au bout du tracé, pour prolonger la route. |
| `delete` | Retirer un point | Double-cliquez un carré pour le retirer (ou cliquez-le, puis Suppr). |
| `ruler` | Mesurer | Maj + glisser mesure un cap et une distance, sans donner d'ordre. |
| `altitude` | L'altitude d'un point | Cliquez un carré, puis ↑ ou ↓ : l'altitude visée en allant vers ce point. |
| `end` | Leçon terminée | Convois et groupes d'escorte se tracent et se corrigent de même. L'aide (?) réunit ces gestes sous « Tracés et ordres sur la carte ». Leçon suivante : le carburant. |

## Les rubriques de l'aide

| Onglet | Rubriques (ancre) |
| --- | --- |
| La fiche | La fiche d'une unité (`fiche`) · Lire une fiche (`lire`) · Place et taille de la fiche (`place`) · La carte (`carte`) · Tracés et ordres sur la carte (`traces`) · Cap direct et étapes au cap (`caps`) · Unités superposées (`piles`) · Rapports (`rapports`) |
| Air | Face à l'ennemi (`attitude`) · Intercepter un raid, couvrir un convoi (`interception`) · États d'alerte (`alerte`) · Fatigue (`fatigue`) · La page Effectifs (`effectifs`) · Programmer un départ (`programmer`) · Formations : big wing et groupe de soutien (`formations`) · Rassemblement (`rassemblement`) · Trains et stocks (`trains`) · Radars et installations (`radars`) |
| Mer | Appareiller (`appareiller`) · Fin de route d'un convoi (`fin-de-route`) · Rejoindre un convoi (`rejoindre`) · Chasse aux U-Boote (`chasse`) · Repères et contacts U-Boot (`reperes`) · Vitesse, zigzag et traînards (`vitesse`) · Autonomie (`autonomie`) · Silence radio (`silence`) · Le commandement des U-Boote (`bdu`) · Le globe (`globe`) · Patrouilles de Coastal Command (`patrouilles`) · Achats en Amérique (`achats`) |
| Temps et alertes | Les alertes ralentissent le temps (`alertes`) · À décider (`decider`) · Pages et pause (`pages`) · Le rythme des quarts (`quarts`) |
| Parties et réglages | Le menu principal (`menu`) · Le menu d'une partie (`partie`) · Sauvegardes (`sauvegardes`) · Exporter et importer (`fichiers`) · Si le navigateur n'enregistre plus (`stockage`) · Réglages de la partie, réglages du joueur (`reglages`) · Astuces de première fois (`astuces`) |
| Touches | Clavier (`touches`) |

## Textes jamais affichés

Aucun code ne lisait ces 38 clés. Le texte de `orders.alertHint` est devenu la bulle « Au
sol » ; les 37 autres sont retirées.

| Clé | Texte |
| --- | --- |
| `app.loading` | Chargement de la table de traçage… |
| `panel.sheet` | Fiche |
| `orders.cruise` | Croisière |
| `orders.orbit` | Orbiter (Orbit) |
| `orders.home` | Rentrer (Pancake) |
| `orders.sail` | Appareiller |
| `orders.centre` | Centrer la carte |
| `orders.escortSailHint` | Préparez des étapes ou une route, puis appareillez. |
| `orders.alertHint` | Le délai d'un état, c'est le temps pour être en l'air après l'ordre de décoller. Monter d'… |
| `orders.convoySpeed` | Vitesse |
| `orders.speedBest` | {n} nœuds (le maximum) |
| `orders.formation` | Big Wing |
| `orders.followLeader` | Voler avec {name} |
| `orders.leaveFormation` | Quitter la formation |
| `orders.formationHint` | En formation, l'escadrille suit son chef et attaque avec lui : l'escorte allemande se part… |
| `orders.speed` | Vitesse |
| `orders.rosterIntro` | Le planning de chaque escadrille se répète chaque jour, de 00:00 à 24:00 (des heures, pas… |
| `orders.rosterEmpty` | Vide : l'escadrille garde son état. Ajoutez des changements ci-dessous. |
| `orders.hours` | {n} h |
| `orders.breakOff` | Désengager {raid} |
| `orders.homePortPick` | Rentrer au port… |
| `map.noIntercept` | Interception impossible |
| `map.nothing` | rien en vue |
| `map.now` | maintenant |
| `map.rail` | chemin de fer |
| `map.zigzag` | zigzag |
| `sites.status.intact` | En service |
| `sites.status.damaged` | Endommagé |
| `sites.status.out` | Hors service |
| `sites.effects.none` | Aucun |
| `profile.title` | Vue de profil |
| `profile.contactNone` | Le raid est trop loin ou trop rapide pour le contact au cap actuel. |
| `profile.you` | {squadron} |
| `types.Hurricane` | Hurricane |
| `types.Spitfire` | Spitfire |
| `unit.roe` | Face à l'ennemi |
| `menu.open` | Menu |
| `menu.openTitle` | Menu de la partie : reprendre, sauvegarder, réglages, recommencer, menu principal |

Lues seulement par du code mort, retirées avec lui :

| Clé | Texte |
| --- | --- |
| `orders.followRefused` | Impossible de rejoindre cette escadrille. |
| `orders.escortSail` | Appareiller |
| `orders.behaviour` | Face aux U-Boote |

Gardées : `save.details.note` (une note pour les traducteurs), `mru.hint` (affichée pendant
la pose d'une station mobile), `profile.window` (légende du profil de montée).
