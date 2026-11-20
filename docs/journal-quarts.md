# Journal — les quarts dès qu'il y a des navires (version 2.12.0)

Branche `quarts-navires`, partie de `aide-en-jeu` (version 2.11.1, demande de fusion nº 11).
Décision de Florian du 20 novembre 2026 : tout scénario qui a des navires vit au rythme des
quarts. Elle remplace « Kanalkampf, Adlertag et le 15 septembre ne changent pas » du M2
(`claude/decisions-audit-m2.md`, section « La mer »).

Ce journal dit ce qui a été fait point par point, les choix que la demande laissait ouverts,
les mesures du joueur automatique avant et après, les tests existants modifiés, et les
questions.

Le chantier touche `src/sim` : les tests, le lint, la construction, l'essai de fumée entier,
le singe à 10 000 ordres par scénario et le joueur automatique ont tous tourné.

## Point par point

### 1. La règle

- `hasShips(scenario)`, dans `src/sim/watch.js` : un scénario a des navires s'il a des
  convois, des groupes d'escorte ou des convois programmés (`convoys`, `escorts`,
  `convoySchedule`). `createWatch` donne alors un quart au monde, et le silence radio en
  dépend comme avant (`isSilent`).
- La règle se lit sur le scénario tel que le jeu le joue : une leçon, avec les clés de sa
  base. `lecon-ravitailler` part de Kanalkampf avec `convoys: []` et `escorts: []` : pas de
  quart. Les trois leçons bâties sur `m0-july-1940` écrivent `convoys: []` : elles n'héritent
  pas de son convoi.
- **La clé `seaRhythm` disparaît des cinq scénarios qui la portaient.** Le rythme ne se
  déclare plus, il se déduit : un scénario ne peut plus l'oublier, ni le contredire. Voir
  « Choix », point 1.
- Test (`tests/scenarios.test.js`) : chaque fichier de `data/scenarios`, leçons comprises,
  est chargé ; le monde a un quart si et seulement si le scénario a des navires, et le
  silence radio suit. La liste d'aujourd'hui est écrite en clair :

| Au rythme des quarts | Sans navire, rien ne change |
| --- | --- |
| `kanalkampf`, `adlertag`, `hiver-atlantique`, `lecon-escorter`, `m0-july-1940` | `quinze-septembre`, `lecon-intercepter`, `lecon-tracer`, `lecon-ravitailler`, `lecon-alerte` |

### 2. Le bouton « Quart » dès le début

- `toolOffered('watch')` répond oui dès qu'il y a un quart (`src/ui/offered.js`).
- `openWatch` ouvre une page même sans rapport, par le bouton comme par la touche Q
  (`src/ui/watchPanel.js`) : « Aucun rapport n'est encore écrit : le premier viendra à la
  relève de 8 h. », puis une ligne sur ce qu'est un rapport. L'heure est celle de la
  prochaine relève à l'horloge du jeu (`nextReliefHour`).
- La page montre aussi ce qui attend déjà une décision, avec ses boutons : à Kanalkampf,
  les deux convois HX sans route et le HX 55 à portée des groupes. Le bouton « Quart »
  compte ces décisions dès la première seconde ; une page qui dirait « rien » à côté d'un
  « 3 » rouge aurait dérouté. Elle n'a qu'un bouton, « Fermer » : rien n'a arrêté le jeu.

### 3. Les alertes restent en direct près de nous

- `followedLive(world, navire)`, dans `src/sim/comms.js` : le navire est en eaux suivies
  (`inTrackedWaters`, les eaux du silence radio, inchangées) ou un de nos avions le voit
  (`aircraftInSight`, inchangée : de jour à 25 km, de nuit au radar ASV). N'importe quelle
  escadrille en vol compte, la chasse qui couvre un convoi aussi.
- `happensNearUs(world, événement)`, dans `src/sim/watch.js` : l'événement se passe près de
  nous si son navire est suivi. Le navire d'un événement est le convoi ou le groupe qu'il
  nomme. Un U-Boot vu par un avion n'a pas de navire à lui : il est près de nous s'il est vu
  en eaux suivies, ou par un avion qui veille sur un de nos navires.
- La simulation marque l'événement (`live`) au moment où il se produit ; `alertFor`
  (`src/ui/alertRules.js`) laisse passer une alerte de mer quand elle porte cette marque.
  Elle ramène le jeu à ×1, comme sans les quarts. La règle ne dépend pas du réglage
  « Communications en mer » : elle vaut aussi en Arcade.
- Dans les deux cas l'événement est noté pour le rapport, qui reste complet.
- La première attaque d'un convoi dans la nuit n'arrête plus le jeu quand elle se passe
  près de nous : l'alerte en direct a appelé le joueur. Elle compte pour la nuit, si bien
  qu'une seconde attaque, en haute mer, va au rapport.
- Une décision dont le joueur a été averti en direct (convoi arrêté, convoi à portée d'un
  groupe, grenades épuisées) est tenue pour posée : la relève suivante la liste sous « À
  décider » sans arrêter le jeu une seconde fois pour elle.
- Les raids, les combats aériens, les questions des escadrilles et les alertes des bases ne
  changent pas.

Le CW 7 : sur sa route de l'Amirauté, il ne quitte pas les eaux suivies. Un test le suit de
la Tamise au Solent, un relevé toutes les dix minutes : 141 sur 141 (tes 47 sur 47, pris
toutes les demi-heures). Ses trois bombardements appellent le joueur aussitôt, et chacun est
dans un rapport.

### 4. Les convois côtiers au rapport

- `writeReport` liste tout convoi en mer, arrêté, ou dont le quart a quelque chose à dire.
  Le CW 7 à l'ancre n'y paraît pas tant qu'il n'a pas appareillé.
- Sa ligne ne dit pas « sans escorte » : aucun groupe d'escorte n'est attendu avec un
  convoi côtier.
- Le filtre « Un convoi ou un groupe… » de l'onglet « Signaux » le propose.
- Un convoi côtier arrêté, ou sans route, compte comme une décision (point 5). L'escorte à
  envoyer et les repères U-Boote restent l'affaire des convois de haute mer.

### 5. Un convoi sans route est une décision

- `noRoute(world, convoi)` : il est en mer, n'a ni tracé ni étapes ni ordre de fin, et
  aucun ordre de route ne l'attend (par radio à la relève, ou porté par un groupe). Il garde
  son cap. La route de l'Amirauté n'est pas une chose à part : une fois donnée, c'est son
  tracé.
- La décision s'appelle `adrift` dans le code. Texte : « HX 57 n'a plus de route à suivre :
  il garde son cap au 60°, aussi loin que la mer le porte. » Boutons : « Amirauté » (la
  route de l'Amirauté depuis son point le plus proche devant, quand le convoi en a une) et
  « Voir ». Sa ligne du rapport dit « sans route, garde son cap ».
- Elle est posée une fois, à la relève où elle apparaît, et arrête le jeu comme les autres.
  Sans réponse, elle reste dans les rapports suivants sans arrêter de nouveau. Si le convoi
  retrouve une route puis la perd (la fin de ses étapes), la question revient.
- Sous silence radio, « Amirauté » part par radio à la relève : la question est tenue pour
  réglée dès l'envoi, et la page l'écrit « (réglé) ».
- Dans une partie jouée sans ordres, le HX 57 est maintenant dans « À décider » de chaque
  rapport, et le jeu s'arrête pour lui à la première relève (test).

### 6. Textes et réglages

Les textes qui réservaient les quarts et le silence radio à l'Atlantique, tous dans
`data/i18n/fr.json` :

| Où | Ce qui change |
| --- | --- |
| Aide, « Le rythme des quarts » (Temps et alertes) | « Dès qu'un scénario a des navires… » ; un paragraphe nouveau sur les alertes près de nous ; le convoi sans route parmi les décisions ; le bouton « Quart » là dès le début |
| Aide, « Les alertes ralentissent le temps » | « en mer, une alerte près de nous ramène à ×1 et le reste attend le rapport de la relève » |
| Aide, « Repères et contacts U-Boot » (« U-Boot en vue ») | l'alerte près de nous, le rapport en haute mer |
| Aide, « Silence radio » | « dès qu'un scénario a des navires » ; les radars de Downhill et de Glenarm rendus à l'hiver 1941 |
| Aide, « Touches » | « Q, rapport de quart (dès qu'il y a des navires) » |
| Aide, « Ce scénario » de Kanalkampf | un paragraphe nouveau : les quarts, les deux HX sans route, le silence radio, le CW 7 en direct |
| Aide, « Ce scénario » d'Adlertag | un paragraphe nouveau : la vue Atlantique, le HX 62, Aldergrove, les quarts |
| Aide, « Ce scénario » de l'Atlantique | une phrase sur les alertes près de nous |
| Bulle « Communications en mer » | « Silence radio, dès qu'un scénario a des navires : … » |
| Bulle « Arrêt aux relèves » | « Dès qu'un scénario a des navires… » ; la première attaque « en haute mer » ; les alertes près de nous |
| Fin de la leçon « Escorter » | les quarts et le silence radio valent dès qu'une bataille a des navires |
| Premier message d'Adlertag | « (vue Atlantique, touche A) » et les deux escadrilles d'Aldergrove |
| Fiche technique du Hudson | l'ASV « dès 1940 », et non « fin 1940 » (voir point 7) |

Réglages : dans les réglages d'une partie sans navire, « Communications en mer » et « Arrêt
aux relèves » sont grisés, chacun avec la ligne « Ce scénario n'a pas de navire : ce réglage
n'y change rien. » Dans les réglages du menu principal, qui valent pour les parties à venir,
ils restent libres.

### 7. Adlertag

- **Vue Atlantique** (touche A) ajoutée aux vues du scénario. La bataille s'ouvre toujours
  sur l'Angleterre.
- **Aldergrove** comme dans Kanalkampf : même place, mêmes stocks (20 t de carburant). Les
  patrouilles ne puisent pas dans le carburant de la chasse : la base ne peut pas mettre la
  partie en panne sèche.
- **502 Sqn** : Anson, six avions, sans radar. C'est la fiche de Kanalkampf, et celle de
  l'Atlantique ramenée à août 1940 (le Whitley et son ASV viennent à l'automne).
- **233 Sqn** : Hudson, six avions, radar ASV. C'est sa fiche de l'Atlantique.

Sources, lues par la recherche (voir « Ce que je n'ai pas pu faire ») :

| Source | Ce qu'elle dit |
| --- | --- |
| [historyofwar.org, 502 Sqn](https://www.historyofwar.org/air/units/RAF/502_wwII.html) | Anson I de janvier 1939 à novembre 1940 ; Whitley V à partir d'octobre 1940 |
| [historyofwar.org, 233 Sqn](https://www.historyofwar.org/air/units/RAF/233_wwII.html) | Leuchars jusqu'en août 1940 ; Aldergrove en août et septembre ; Leuchars de septembre à décembre ; Hudson depuis août 1939 |
| [pegasusarchive.org](https://pegasusarchive.org/arnhem/batt_233.htm) | en août 1940, le 233 passe à Aldergrove pour escorter les convois de Liverpool et de la Clyde ; il repart à Leuchars un mois plus tard |
| [rafweb.org, Coastal Command, août 1940](https://www.rafweb.org/Members%20Pages/Orders%20of%20Battle/1940/1940_08_Coastal.htm) | **autre chose** : à Aldergrove le 224 Sqn (Hudson), le 502 Sqn noté « Whitleys » et un flight du 48 Sqn (Anson) ; le 233 à Leuchars ; le 500 à Detling sur Anson |

Trois sources sur quatre confirment ton histoire. L'ordre de bataille de rafweb (document
SD161, 5e édition) note déjà le 502 sur Whitley et place le 224, non le 233, à Aldergrove.
L'histoire officielle britannique dit que des éléments du 224 et du 233 y étaient détachés
([The Defence of the United Kingdom, annexe](https://ibiblio.org/hyperwar/UN/UK/UK-Defence-UK/UK-DefenseOfUK-XVIII.html)).
J'ai suivi ta consigne : 502 sur Anson, 233 sur Hudson.

**L'ASV des Hudson.** Le radar ASV Mk I équipe douze Hudson dès la mi-janvier 1940
([S. Watts, IEEE AES Magazine, 2019](https://nxtbook.com/nxtbooks/ieee/aerospace_august2019/index.php?startid=50)),
et vingt-quatre fin 1940 ([uboat.net](https://uboat.net/allies/technical/uk_radars.htm)),
qui juge ses résultats médiocres. Un historique du 233 dit ses Hudson « équipés du radar »
à leur arrivée à Aldergrove en août 1940
([miscellavia.com](https://miscellavia.com/raf-233-squadron/)). J'ai donc gardé l'ASV au
233. Mais vingt-quatre appareils fin 1940, c'est peu pour cinq escadrilles : une partie
seulement des six avions du jeu l'aurait eu. Voir « Questions ».

### 8. Mesures

Voir « Mesures du joueur automatique », plus bas.

### 9. Parties sauvegardées

**Choix : une partie de Kanalkampf ou d'Adlertag sauvegardée avant la 2.12.0 reprend au
rythme des quarts.** Une seule règle pour toutes les parties qui ont des navires ; garder
ces parties « en direct » aurait laissé dans le jeu un second mode que plus rien d'autre
n'emploie ni ne teste.

- Les sauvegardes passent au **format 3** (`src/save/migrate.js`). La migration du format 2
  retire le quart vide d'une partie qui n'en tenait pas : le monde sur lequel elle est
  remise garde celui d'une partie qui commence. Les rapports d'une partie de l'Atlantique
  reviennent tels quels.
- La partie reprend à son heure. Le premier rapport s'écrit à la relève qui suit le
  chargement, et le jeu s'y arrête pour ce qui attend. Sous silence radio, ses navires en
  haute mer sont placés par estimation à partir de là.
- Elle garde ce avec quoi elle a commencé : une partie d'Adlertag d'avant a Aldergrove sur
  sa carte et la vue Atlantique, mais pas les deux escadrilles, qui n'étaient pas dans cette
  partie.
- Tests (`tests/oldsaves.test.js`) : une partie de Kanalkampf sauvegardée par la 2.11.1
  (`tests/fixtures/save-2.11.1-kanalkampf.json.gz`, faite par `make-save-2.11.1.mjs` depuis
  un état du dépôt en 2.11.1) reprend, écrit son premier rapport à midi, s'arrête pour le
  HX 57 sans route, joue deux jours, et se sauvegarde puis se recharge à l'identique. Les
  parties d'Adlertag sauvegardées par la 2.6.1 et la 2.9.0 se chargent et continuent.
- Une version antérieure refuse une sauvegarde de la 2.12.0 (« venue d'une version plus
  récente »), comme pour tout nouveau format.

## Choix que la demande laissait ouverts

1. **Le rythme se déduit, il ne se déclare plus.** Tu demandais une règle et un test. J'ai
   mis la règle dans le jeu (`hasShips`) et retiré `seaRhythm` des données, plutôt que de
   garder la clé et de la contrôler par un test. Raison : « la règle se lit sur le scénario
   complet » ; avec une clé héritée, `lecon-ravitailler` aurait reçu « quarts » de
   Kanalkampf et il aurait fallu la corriger à la main. Le test reste, et il liste les
   scénarios. Le test existant qui exigeait la clé est remplacé par ce test, plus strict.
2. **La page d'avant le premier rapport montre les décisions en attente.** Tu demandais
   qu'elle dise qu'aucun rapport n'est écrit et quand viendra le premier. Elle le dit, et
   elle ajoute « À décider ».
3. **Une alerte en direct remplace l'arrêt de nuit, et vaut question posée.** Sans cela, le
   même événement aurait appelé le joueur deux fois : par l'alerte, puis par l'arrêt.
4. **Un U-Boot vu par un avion** est près de nous en eaux suivies, ou si l'avion veille sur
   un de nos navires. Je n'ai inventé aucune distance : ce sont celles du silence radio.
5. **Les convois côtiers comptent dans les décisions** (arrêté, sans route), pas seulement
   dans la liste du rapport.
6. **La décision « sans route » revient** quand le convoi retrouve puis reperd sa route.
   « Posée une fois » vaut pour chaque fois où elle apparaît.
7. **La barre du haut à 1 024 px.** Avec le bouton « Quart » présent dès le début et le
   signe d'une sauvegarde manquée, la barre passait sur deux lignes dans l'Atlantique et à
   Kanalkampf. Sous 1 100 px de large, le cadran de l'horloge quitte la barre ; l'heure
   reste, en chiffres. Ce n'était pas demandé : c'est une conséquence du point 2.
8. **La fiche du Hudson** disait « certains reçoivent le premier radar ASV fin 1940 ». Les
   sources le datent de janvier 1940 : la phrase est corrigée.
9. **Le joueur automatique des batailles aériennes** donnait ses ordres aux navires sans
   passer par la radio et lisait leur position vraie. Il passe maintenant par la voie qui
   atteint le navire et lit la position affichée, comme celui de l'Atlantique. En direct,
   ses parties sont identiques (vérifié sur deux parties avant de mesurer).

## « Abords des côtes » : ce que couvrent les eaux suivies

Les eaux suivies sont celles du silence radio, inchangées : les quatre eaux fermées aux
U-Boote (mer d'Irlande, canal du Nord et Clyde ; Hébrides intérieures et Minch ; Manche ;
canal de Bristol), les approches des ports à moins de 80 km, et la couverture de surface des
radars côtiers. Mesuré sur les routes de l'Amirauté :

| Convoi | Route | En eaux suivies |
| --- | --- | --- |
| CW 7 (Kanalkampf) | 306 km | tout du long |
| HX 55, HX 57 (Kanalkampf), HX 62 (Adlertag) | 1 290 à 3 365 km | les 313 derniers kilomètres, depuis l'entrée du canal du Nord (55,3° N 6,1° O) : environ 19 h |
| HX et SC (Atlantique) | 4 337 à 4 595 km | les 80 premiers kilomètres, puis les 385 derniers, depuis la couverture de Downhill (55,6° N 7,1° O) : 23 h pour un HX, 30 h pour un SC |

Ce que ces eaux ne couvrent pas :

- les atterrages de l'ouest avant le canal du Nord, où les U-Boote attendaient ;
- la côte de la mer du Nord, au nord de la Tamise ;
- les abords sud-ouest (Cornouailles, mer Celtique).

Seuls Downhill et Glenarm, dans l'Atlantique, ont une couverture de surface (50 km). Les
neuf radars Chain Home de Kanalkampf et d'Adlertag n'en ont pas : ils ne « suivent » aucun
navire.

**Si « abords des côtes » doit dire plus, voici trois façons, de la plus simple à la plus
large. Je n'en ai fait aucune.**

1. Donner une couverture de surface aux radars de la côte sud et est (une valeur par
   station, comme pour Downhill). Le mécanisme existe ; il faut choisir les stations et la
   portée.
2. Tenir tout convoi côtier pour suivi, où qu'il aille. Sa position est déjà dessinée en
   direct partout ; ses ordres et ses alertes suivraient. Aujourd'hui, un CW que tu
   routerais hors des eaux suivies serait vu en direct, mais recevrait ses ordres à la
   relève.
3. Une bande le long des côtes britanniques, de la largeur que tu fixerais.

## Mesures du joueur automatique

MESURES

## Tests existants modifiés

Aucun n'est affaibli. Ceux qui énonçaient l'ancienne règle énoncent la nouvelle.

| Test | Ce qu'il disait | Ce qu'il dit |
| --- | --- | --- |
| `tests/scenarios.test.js`, « Code 6, N8 » | chaque scénario déclare `seaRhythm`, et l'Atlantique vaut « watches » | ces deux lignes sont remplacées par le test de la règle, sur chaque fichier de scénario |
| `tests/watch.test.js`, « the rhythm… » | quarts dans l'Atlantique, alertes en direct à Kanalkampf | quarts à Kanalkampf aussi ; alertes d'avant le 15 septembre, sans navire ; l'alerte près de nous |
| `tests/comms.test.js`, « the setting… » | Kanalkampf garde sa mer en direct | à Kanalkampf, le HX 55 est vu par estimation, le CW 7 en direct ; pas de silence le 15 septembre |
| `tests/alerts.test.js` (trois tests) | une attaque, un U-Boot vu, appellent le joueur à Kanalkampf | ils l'appellent près de nous (événement marqué), et vont au rapport en haute mer |
| `tests/alertqueue.test.js` (deux tests) | idem, pour un convoi bombardé et un convoi à portée | l'événement est marqué « près de nous » |
| `tests/watchpanel.test.js`, « the report… closed » | pas de bouton « Quart » avant le premier rapport, ni à Kanalkampf | le bouton est là dès le début, à Kanalkampf aussi ; pas le 15 septembre |
| `tests/review29.test.js`, « a tool or a view… » | Adlertag n'offre pas la vue Atlantique | c'est le 15 septembre qui ne l'offre pas ; Adlertag l'offre |
| `tests/migrate.test.js` | le format écrit est le 2 | le format écrit est le 3 ; la migration du format 1 mène au format en usage |
| `tests/oldsaves.test.js`, partie de la 2.10.2 | « une sauvegarde du format en usage » | une sauvegarde du format 2, plus ancien que le format en usage |

À l'essai de fumée : aucune vérification retirée. La partie « menus » ferme d'abord une
page de rapport restée ouverte, puisque Kanalkampf a maintenant des relèves.

## Vérifications

VERIFICATIONS

## Relecture par un agent neuf

RELECTURE

## Ce que je n'ai pas pu faire

- **Lire tes quatre pages une à une.** L'outil qui ouvre une adresse a demandé ton accord,
  et tu n'étais pas là pour le donner. J'ai lu ces mêmes pages par la recherche, qui en
  rend des extraits, et ouvert celle de rafweb une fois la recherche passée par elle. Les
  faits du point 7 viennent de ces extraits. Si tu veux une lecture complète, redemande-la.
- **Essayer hors de Chrome.** Tout l'essai de fumée tourne dans Chrome sans écran.
- **Jouer à la main.** Comme avant : c'est toi qui diras si les quarts se vivent bien à
  Kanalkampf.

## Questions

QUESTIONS
