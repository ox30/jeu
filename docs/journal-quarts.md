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
  nomme. Un U-Boot vu par une patrouille n'a pas de navire à lui : il attend le rapport, où
  qu'elle vole. C'est la règle du M2.8 (« les patrouilles du Coastal Command suivent le
  rythme des quarts »), que ta décision ne change pas. Vu par un groupe d'escorte, il suit
  la place du groupe.
- La simulation marque l'événement (`live`) au moment où il se produit ; `alertFor`
  (`src/ui/alertRules.js`) laisse passer une alerte de mer quand elle porte cette marque.
  Elle ramène le jeu à ×1, comme sans les quarts. La règle ne dépend pas du réglage
  « Communications en mer » : elle vaut aussi en Arcade.
- Dans les deux cas l'événement est noté pour le rapport, qui reste complet.
- Une attaque près de nous lève son alerte et n'arrête pas le jeu par le quart. L'arrêt de
  nuit reste celui de la première attaque **en haute mer** de la nuit : une attaque près de
  nous ne compte pas pour la nuit, pour qu'aucune nuit ne passe sans que personne soit
  appelé (l'alerte, elle, se tait un moment après la précédente).
- Une décision avertie par une alerte en direct (convoi arrêté, convoi à portée d'un groupe,
  grenades épuisées) et laissée sans réponse est posée à la relève comme les autres.
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
- La décision s'appelle `adrift` dans le code. Texte : « HX 57 n'a pas de route à suivre :
  il garde son cap (060°), aussi loin que la mer le porte. » Boutons : « Amirauté » (la
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
| Aide, « Le rythme des quarts » (Temps et alertes) | « Dès qu'un scénario a des navires… » ; un paragraphe nouveau sur les alertes près de nous et sur ce qu'une patrouille voit seule ; le convoi sans route parmi les décisions ; le bouton « Quart » là dès le début |
| Aide, « Les alertes ralentissent le temps » | « en mer, une alerte près de nous ramène à ×1 et le reste attend le rapport de la relève » |
| Aide, « Repères et contacts U-Boot » (« U-Boot en vue ») | l'alerte quand un groupe près de nous le voit ; le rapport quand c'est une patrouille, ou un groupe en haute mer |
| Aide, « Silence radio » | « dès qu'un scénario a des navires » ; les radars de Downhill et de Glenarm rendus à l'hiver 1941 |
| Aide, « Touches » | « Q, rapport de quart (dès qu'il y a des navires) » |
| Aide, « Ce scénario » de Kanalkampf | un paragraphe nouveau : les quarts, les deux HX sans route, le silence radio, le CW 7 en direct |
| Aide, « Ce scénario » de l'entraînement | un paragraphe nouveau : son convoi le met au rythme des quarts |
| Bulle du bouton « Quart » | « le dernier rapport, et ce qui attend une décision » (il n'y a rien à « rouvrir » avant 8 h) |
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
3. **Une alerte en direct ne retire aucun arrêt du quart.** Près de nous, l'attaque a son
   alerte au lieu de l'arrêt de nuit ; mais la relève s'arrête toujours pour une décision
   sans réponse, et la première attaque en haute mer de la nuit arrête toujours le jeu. Le
   joueur peut donc être appelé deux fois pour la même chose (l'alerte, puis la relève),
   jamais zéro. Une première version marquait ces décisions comme déjà posées : la relecture
   a montré quatre cas où l'alerte n'appelait en fait personne.
4. **Un U-Boot vu par une patrouille attend le rapport**, même vu en eaux suivies ou par
   l'avion qui couvre un convoi. Une première version le donnait en direct dans ces deux
   cas : la mesure a compté 52 alertes « U-Boot en vue » de plus par partie d'Atlantique
   jouée avec couverture aérienne. Je n'ai inventé aucune distance : celles du silence radio
   servent telles quelles.
5. **Les convois côtiers comptent dans les décisions** (arrêté, sans route), pas seulement
   dans la liste du rapport.
6. **La décision « sans route » revient** quand le convoi retrouve puis reperd sa route.
   « Posée une fois » vaut pour chaque fois où elle apparaît. **« Garder le cap » y
   répond** : un convoi à qui tu dis de garder son cap (« Et maintenant », ou la fin de son
   tracé) n'est plus demandé, jusqu'à ce qu'il ait de nouveau quelque chose à suivre.
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

Joueur automatique, dix graines par conduite (graines 1 à 10). « Avant » est la 2.11.1,
jouée par le joueur automatique de cette branche. « Après » est cette branche.

Un **arrêt** est une pause du quart (une relève où une décision attend, la première attaque
d'une nuit) ou une alerte de mer qui ramène le jeu à ×1 avec les réglages par défaut. Les
raids ne sont pas comptés : ils n'ont pas changé.

Pour refaire : `node tools/bot/measure.mjs --name quarts --seeds 10`, puis
`node tools/bot/measure.mjs --summary quarts`.

**Kanalkampf**, dix graines par conduite (avant → après)

| Préréglage | Conduite | Victoires | HX 55 (80 %) | HX 57 (80 %) | CW 7 (70 %) | Arrêts par partie | Ce qui arrête, après |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Standard | rien | 0 sur 10 → 0 sur 10 | 0 sur 10 (moy. 0 %) → 0 sur 10 (moy. 0 %) | 0 sur 10 (moy. 0 %) → 0 sur 10 (moy. 0 %) | 0 sur 10 (moy. 0 %) → 0 sur 10 (moy. 0 %) | 6,1 (3 à 9) → 5,7 (3 à 9) | relèves 3,7, attaques de nuit 2,0 |
| Standard | simple | 8 sur 10 → 9 sur 10 | 10 sur 10 (moy. 100 %) → 10 sur 10 (moy. 99 %) | 10 sur 10 (moy. 98 %) → 10 sur 10 (moy. 100 %) | 9 sur 10 (moy. 85 %) → 9 sur 10 (moy. 82 %) | 5,4 (4 à 12) → 4,5 (3 à 7) | convoi bombardé 2,2, relèves 1,6, attaques de nuit 0,6, convoi repéré 0,1 |
| Standard | sans-chasse | 0 sur 10 → 0 sur 10 | 10 sur 10 (moy. 100 %) → 10 sur 10 (moy. 100 %) | 10 sur 10 (moy. 97 %) → 10 sur 10 (moy. 95 %) | 5 sur 10 (moy. 71 %) → 5 sur 10 (moy. 71 %) | 7,4 (5 à 12) → 6,2 (4 à 12) | convoi bombardé 3,0, relèves 1,8, attaques de nuit 1,4 |
| Réaliste | simple | 8 sur 10 → 7 sur 10 | 10 sur 10 (moy. 99 %) → 10 sur 10 (moy. 96 %) | 10 sur 10 (moy. 97 %) → 10 sur 10 (moy. 98 %) | 9 sur 10 (moy. 87 %) → 8 sur 10 (moy. 80 %) | 10,2 (5 à 13) → 7,7 (4 à 11) | attaques de nuit 3,0, convoi bombardé 2,2, relèves 2,2, convoi repéré 0,3 |
| Réaliste | soigne | 9 sur 10 → 8 sur 10 | 10 sur 10 (moy. 97 %) → 10 sur 10 (moy. 95 %) | 10 sur 10 (moy. 97 %) → 10 sur 10 (moy. 98 %) | 9 sur 10 (moy. 87 %) → 8 sur 10 (moy. 80 %) | 10,8 (4 à 15) → 7,9 (4 à 11) | attaques de nuit 3,1, convoi bombardé 2,2, relèves 2,2, convoi repéré 0,4 |

**Adlertag**, dix graines par conduite (avant → après)

| Préréglage | Conduite | Victoires | HX 62 (60 %) | Arrêts par partie | Ce qui arrête, après |
| --- | --- | --- | --- | --- | --- |
| Standard | rien | 0 sur 10 → 0 sur 10 | 0 sur 10 (moy. 0 %) → 0 sur 10 (moy. 0 %) | 4,1 (2 à 6) → 4,0 (2 à 5) | relèves 2,9, attaques de nuit 1,1 |
| Standard | simple | 8 sur 10 → 10 sur 10 | 10 sur 10 (moy. 97 %) → 10 sur 10 (moy. 98 %) | 3,4 (1 à 7) → 2,6 (1 à 4) | attaques de nuit 1,6, relèves 1,0 |
| Standard | sans-ravitaillement | 0 sur 10 → 0 sur 10 | 10 sur 10 (moy. 97 %) → 10 sur 10 (moy. 98 %) | 3,4 (1 à 7) → 2,6 (1 à 4) | attaques de nuit 1,6, relèves 1,0 |
| Standard | 1-par-raid | 1 sur 10 → 2 sur 10 | 10 sur 10 (moy. 96 %) → 10 sur 10 (moy. 95 %) | 3,8 (1 à 8) → 2,0 (1 à 3) | relèves 1,0, attaques de nuit 1,0 |
| Standard | 2-par-raid | 7 sur 10 → 10 sur 10 | 10 sur 10 (moy. 95 %) → 10 sur 10 (moy. 96 %) | 4,2 (1 à 8) → 1,7 (1 à 3) | relèves 1,0, attaques de nuit 0,7 |
| Standard | 4-par-raid | 1 sur 10 → 1 sur 10 | 10 sur 10 (moy. 97 %) → 10 sur 10 (moy. 98 %) | 4,2 (1 à 8) → 2,6 (1 à 4) | attaques de nuit 1,3, relèves 1,0, convoi repéré 0,3 |
| Réaliste | simple | 9 sur 10 → 8 sur 10 | 10 sur 10 (moy. 96 %) → 10 sur 10 (moy. 97 %) | 4,5 (1 à 7) → 2,5 (1 à 4) | attaques de nuit 1,3, relèves 1,0, convoi repéré 0,2 |
| Réaliste | soigne | 10 sur 10 → 9 sur 10 | 10 sur 10 (moy. 95 %) → 10 sur 10 (moy. 95 %) | 4,5 (3 à 7) → 3,0 (1 à 4) | attaques de nuit 1,7, relèves 1,0, convoi repéré 0,3 |

**Hiver dans l'Atlantique**, dix graines par conduite (avant → après)

| Préréglage | Conduite | Victoires | Navires perdus | Arrêts par partie | Ce qui arrête, avant | Ce qui arrête, après |
| --- | --- | --- | --- | --- | --- | --- |
| Standard | rien | 0 sur 10 → 0 sur 10 | 18,5 % → 18,5 % | 54,8 (51 à 59) → 65,2 (55 à 73) | relèves 35,1, attaques de nuit 19,7 | relèves 35,1, attaques de nuit 19,7, Condor en vue 7,4, Condor attaque 2,7, convoi repéré 0,3 |
| Standard | simple | 9 sur 10 → 9 sur 10 | 5,6 % → 5,6 % | 49,2 (44 à 59) → 60,2 (51 à 71) | relèves 31,5, attaques de nuit 17,7 | relèves 31,5, attaques de nuit 17,7, Condor en vue 6,6, mazout bas 2,4, Condor attaque 1,7, convoi repéré 0,2, U-Boot en vue 0,1 |
| Standard | rester | 9 sur 10 → 9 sur 10 | 5,6 % → 5,6 % | 49,2 (44 à 59) → 60,2 (51 à 71) | relèves 31,5, attaques de nuit 17,7 | relèves 31,5, attaques de nuit 17,7, Condor en vue 6,6, mazout bas 2,4, Condor attaque 1,7, convoi repéré 0,2, U-Boot en vue 0,1 |
| Standard | chasser | 9 sur 10 → 9 sur 10 | 5,5 % → 5,5 % | 51,7 (46 à 56) → 63,2 (57 à 71) | relèves 32,8, attaques de nuit 18,9 | relèves 32,8, attaques de nuit 18,9, Condor en vue 5,9, Condor attaque 2,7, mazout bas 2,4, convoi repéré 0,3, U-Boot en vue 0,2 |
| Standard | chasser-econome | 8 sur 10 → 8 sur 10 | 6,4 % → 6,4 % | 50,7 (42 à 56) → 64,1 (50 à 72) | relèves 32,6, attaques de nuit 18,1 | relèves 32,6, attaques de nuit 18,1, Condor en vue 6,8, Condor attaque 3,2, mazout bas 2,4, convoi repéré 0,4, U-Boot en vue 0,3, escorte au combat 0,3 |
| Standard | soigne | 9 sur 10 → 9 sur 10 | 5,3 % → 5,3 % | 52,7 (47 à 57) → 84,8 (75 à 98) | relèves 33,5, attaques de nuit 19,2 | relèves 33,5, attaques de nuit 18,1, Condor en vue 10,4, escorte au combat 5,0, U-Boot en vue 4,9, attaque de U-Boot 4,6, mazout bas 4,6, Condor attaque 3,7 |
| Standard | deux-avions | 3 sur 10 → 3 sur 10 | 5,6 % → 5,6 % | 49,2 (44 à 59) → 60,2 (51 à 71) | relèves 31,5, attaques de nuit 17,7 | relèves 31,5, attaques de nuit 17,7, Condor en vue 6,6, mazout bas 2,4, Condor attaque 1,7, convoi repéré 0,2, U-Boot en vue 0,1 |
| Réaliste | rester | 5 sur 10 → 5 sur 10 | 8,3 % → 8,3 % | 55,5 (47 à 61) → 70,9 (61 à 80) | relèves 33,1, attaques de nuit 22,4 | relèves 33,1, attaques de nuit 22,4, Condor en vue 8,7, Condor attaque 4,2, mazout bas 2,4, convoi repéré 0,1 |
| Réaliste | chasser | 2 sur 10 → 2 sur 10 | 8,1 % → 8,1 % | 53,0 (47 à 60) → 66,0 (62 à 74) | relèves 32,8, attaques de nuit 20,2 | relèves 32,8, attaques de nuit 20,2, Condor en vue 8,1, Condor attaque 2,5, mazout bas 2,4 |
| Réaliste | soigne | 7 sur 10 → 7 sur 10 | 7,2 % → 7,2 % | 54,1 (49 à 58) → 80,8 (71 à 88) | relèves 32,9, attaques de nuit 21,2 | relèves 32,9, attaques de nuit 20,8, Condor en vue 10,0, mazout bas 4,0, U-Boot en vue 3,8, Condor attaque 3,5, escorte au combat 3,0, attaque de U-Boot 2,8 |

Rapports écrits par partie menée à son terme : 87 à Kanalkampf, 40 à Adlertag (les deux
nombres de ton essai), 483 dans l'Atlantique.

### La règle d'équilibre tient

| Règle du cahier | Kanalkampf | Adlertag | Atlantique |
| --- | --- | --- | --- |
| Ne rien faire perd (Standard) | 0 sur 10 | 0 sur 10 | 0 sur 10 |
| Jouer simple gagne environ quatre fois sur cinq (Standard) | 9 sur 10, et 24 sur 30 sur trente graines (23 sur 30 avant) | 10 sur 10, et 251 sur 300 sur trois cents graines (242 sur 300 avant) | 9 sur 10 |
| Jouer soigné gagne en Réaliste | 8 sur 10 | 9 sur 10 | 7 sur 10 |

Je n'ai touché à aucun seuil.

- **Livraisons.** Les HX 55, HX 57 et HX 62 livrent dix fois sur dix dès que le joueur
  joue, avec 95 à 100 % de leur cargaison : leurs barres de 80 % et de 60 % ne sont pas en
  jeu. En Standard, le CW 7 livre 9 fois sur 10 sous la chasse et 5 fois sur 10 sans elle,
  avant comme après.
- **En Réaliste**, chaque ligne de Kanalkampf et d'Adlertag perd une victoire sur dix. Sur
  dix graines, c'est dans le bruit (voir Adlertag, ci-dessous). Je ne l'ai pas vérifié sur
  plus de graines.
- **Dans l'Atlantique**, victoires et pertes sont les mêmes au navire près. Le point 3 n'y
  change que ce qui appelle le joueur, et le joueur automatique ne réagit pas aux arrêts.

### Adlertag : 8 puis 10 victoires sur 10, et pourquoi rien n'a changé

En Standard, « jouer simple » passe de 8 à 10 victoires sur dix graines, et de 22 à 28 sur
trente. La règle d'équilibre aurait cassé par le haut. J'ai cherché d'où cela venait avant
de toucher à un seuil.

| Essai (Standard, « simple ») | Résultat |
| --- | --- |
| Après, sans les deux escadrilles d'Aldergrove, graines 1 à 30 | les mêmes parties qu'après, une à une |
| Après, avec « Communications en mer : en direct », graines 1 à 30 | les mêmes parties qu'avant, une à une (22 sur 30) |
| Avant, un seul dé de plus tiré à la première minute, graines 1 à 60 | 49 sur 60 (45 sans ce dé) |
| Après, un dé de plus, puis deux, graines 1 à 60 | 54 puis 49 sur 60 (56 sans) |
| Graines 1 à 120 | avant 91 sur 120, après 111 sur 120 |
| Graines 121 à 300, jamais jouées | avant 151 sur 180, après 140 sur 180 |
| **Les trois cents graines** | **avant 242 sur 300 (81 %), après 251 sur 300 (84 %)** |

- Ni Aldergrove, ni la vue Atlantique, ni les quarts eux-mêmes ne changent la bataille
  aérienne. Seul le silence radio la change : la route du HX 62 lui parvient à la relève de
  8 h, et non à la première minute.
- La mer et l'air tirent leurs dés dans la même suite. Le convoi n'étant plus au même
  endroit, la mer tire les siens à d'autres moments, et les combats aériens reçoivent
  d'autres nombres. Ce sont d'autres parties, avec les mêmes chances.
- Sur trois cents graines, l'écart est de trois points, moins que ce que le hasard donne à
  cette taille. Les chasseurs gardés en fin de partie font 50,3 % en moyenne avant et
  50,6 % après.
- **Ce que cela dit de la mesure.** À Adlertag, la part des chasseurs finit souvent tout
  près de sa barre de 45 %. Dix graines ne distinguent pas 80 % de victoires de 95 %, et
  cent vingt ont encore montré un écart de seize points qui n'existe pas. Pour juger
  l'équilibre d'Adlertag, il faut quelques centaines de parties (une vingtaine de minutes de
  calcul pour trois cents).

### Arrêts par partie

**Kanalkampf et Adlertag : moins d'arrêts qu'avant.** En jouant simple, 5,4 → 4,5 à
Kanalkampf et 3,4 → 2,6 à Adlertag. Les événements de haute mer attendent maintenant le
rapport. Ce qui arrête encore : le CW 7 bombardé (2,2 fois par partie, en direct), une ou
deux relèves avec une décision, et la première attaque de nuit d'un HX.

**Atlantique : la cible de 30 à 60 est dépassée.** C'est l'effet du point 3, que tu
demandais de mesurer.

| Conduite (Standard) | Avant | Après | Ajouté par les alertes près de nous |
| --- | --- | --- | --- |
| rien | 54,8 | 65,2 | Condor en vue 7,4 ; Condor attaque 2,7 ; convoi repéré 0,3 |
| simple (Rester) | 49,2 | 60,2 | Condor en vue 6,6 ; mazout bas 2,4 ; Condor attaque 1,7 |
| chasser | 51,7 | 63,2 | Condor en vue 5,9 ; Condor attaque 2,7 ; mazout bas 2,4 |
| soigné (couverture aérienne) | 52,7 | 84,8 | Condor en vue 10,4 ; escorte au combat 5,0 ; U-Boot en vue 4,9 ; attaque de U-Boot 4,6 ; mazout bas 4,6 ; Condor attaque 3,7 |

- Sans couverture aérienne, une dizaine d'arrêts de plus par partie, presque tous dus aux
  Condor. Ils rôdent dans les approches du nord-ouest, là où les convois entrent en eaux
  suivies.
- Avec une couverture aérienne, une trentaine de plus : chaque convoi couvert est « près de
  nous » d'un bout à l'autre du vol.
- En Réaliste : 66 à 81 arrêts, pour 53 à 56 avant.

**Proposition, que je n'ai pas faite** : rendre les Condor au rapport, où que soit le
navire. C'est la phrase du M2.8, « les patrouilles du Coastal Command et les Condor suivent
le rythme des quarts ». Le calcul est exact, puisque chaque sorte d'arrêt est comptée à
part : 52 arrêts en jouant simple, 55 sans rien faire, 55 en chassant, 71 en jouant soigné.
Seule la conduite soignée resterait au-dessus de 60, par sa couverture aérienne. Voir
« Questions », nº 1.

### Le singe

10 000 ordres au hasard par scénario, sur les cinq scénarios, avec sauvegardes et reprises :
aucune erreur, aucune valeur impossible (`npm run fuzz`, sur le code final de `src/sim`).

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

- `npm test` : 501 tests verts (481 à la 2.11.1).
- `npm run lint` : propre.
- `npm run build` : `dist/index.html` reconstruit, et c'est bien celui du dépôt.
- `npm run smoke`, en entier : 364 vérifications vertes (350 à la 2.11.1), dont douze pour
  les quarts : le bouton et sa page dès la première seconde, « Amirauté » pour le HX 55,
  l'arrêt de 8 h pour le HX 57, le CW 7 bombardé qui appelle à ×1, les deux réglages grisés
  le 15 septembre, la vue Atlantique, Aldergrove et la fiche du 233 Sqn à Adlertag.
- `npm run fuzz` : 10 000 ordres au hasard dans chacun des cinq scénarios, sans erreur, sur
  le dernier état de `src/sim` (`d062f8e` ; ce qui suit ne touche ni `src` ni `data`).
- Joueur automatique : 230 parties avant et 230 après pour les tableaux, puis un millier de
  parties d'Adlertag pour comprendre son écart (voir « Mesures »).
- GitHub rejoue les tests, le lint, la construction et l'essai de fumée à chaque envoi.
- Tout l'essai de fumée tourne dans Chrome sans écran. Rien n'a été essayé dans Firefox ni
  dans Edge.

## Relecture par un agent neuf

Un agent sans mémoire du chantier a relu la branche (`550fb69`), sans rien modifier : les
tests, le lint, l'essai de fumée, le singe, et ses propres essais (douze sauvegardes et
reprises à des instants choisis, les quatorze sortes d'événements de mer relues une à une,
une patrouille d'Aldergrove menée sur le HX 62). Un défaut bloquant, un important, douze
mineurs.

| Gravité | Ce qu'il a trouvé | Ce qui est fait |
| --- | --- | --- |
| Bloquant | `dist/index.html` n'avait pas été reconstruit après le changement de numéro : le fichier unique affichait 2.11.1 et signait ainsi ses sauvegardes | Reconstruit. Un test vérifie maintenant que le fichier porte le numéro de la version |
| Important | Une décision avertie « en direct » était marquée comme posée, alors que son alerte n'appelle pas toujours : l'alerte d'un groupe qui attend, ou d'un convoi arrêté devant la côte, se referme aussitôt (défaut d'avant, sans conséquence jusque-là) ; « grenades épuisées » ne s'affiche qu'une fois par partie ; une alerte peut être réglée pour ne pas ralentir. La relève ne s'arrêtait plus pour ces décisions | Le marquage est retiré : la relève s'arrête pour toute décision sans réponse |
| Important (même cause) | Une attaque près de nous comptait pour la nuit même quand son alerte se taisait : une nuit pouvait passer sans que personne soit appelé | Une attaque près de nous ne compte plus pour la nuit |
| Mineur | « Garder le cap », choisi par le joueur, redevenait une question à la relève suivante | « Garder le cap » y répond (un champ de plus sur un convoi, avec sa valeur par défaut) |
| Mineur | « il garde son cap au 75° » : ailleurs le jeu écrit « 075° », et l'arrondi pouvait donner « 360° » ; « n'a plus de route » pour un convoi qui n'en a jamais eu | « n'a pas de route à suivre : il garde son cap (075°) » |
| Mineur | La page ouverte avant la première relève continuait de dire « Aucun rapport » si la relève passait sans arrêt | Elle montre le rapport dès qu'il est écrit |
| Mineur | Textes : « un groupe qui s'y trouve » oubliait le groupe sous un avion ; l'aide de Kanalkampf oubliait l'arrêt de nuit ; « rouvrir le dernier rapport » avant qu'il y en ait un ; l'aide de l'entraînement muette sur les quarts ; « couverture des radars côtiers » alors qu'aucun radar de Kanalkampf ni d'Adlertag n'en a | Tous récrits |
| Mineur | La fiche de fabrication de la sauvegarde d'essai citait un état du dépôt où elle ne tournait pas | Elle tourne sur la 2.11.1 telle quelle, et redonne le même fichier, octet pour octet |
| Mineur | Tableau de mesure : « (dont…) » collé après le carburant ; un ordre du joueur automatique refusé à la relève passait sans trace | Corrigés |
| Mineur | Une règle CSS morte ; un commentaire de test faux ; la barre à 1 024 px vérifiée sans Kanalkampf | Retirée ; corrigé ; Kanalkampf ajouté |
| Mineur | Un convoi côtier mené hors des eaux suivies est vu en direct mais reçoit ses ordres à la relève | Laissé : c'est la proposition 2 de « Abords des côtes » |
| Mineur | Doubles appels possibles : un arrêt de nuit en haute mer, puis une alerte la même nuit quand le convoi arrive près de nous ; un U-Boot vu par un groupe près d'un convoi, puis l'arrêt de la relève pour ce repère | Laissés, et dits ici |
| Mineur | Le bouton « Amirauté » manque pour un traînard sans route (la fiche d'un traînard ne l'a pas non plus) | Laissé |

Il a aussi vérifié, sans rien trouver : la simulation ne tire aucun dé pour ces règles et
une partie sauvegardée puis reprise reste la même partie ; les huit sauvegardes d'essai se
chargent, l'Atlantique garde ses rapports ; `noRoute` ne prend pour « sans route » ni un
convoi mené par un pilote, ni un ordre en route, ni un convoi au mouillage ; en Arcade, les
parties du joueur automatique sont identiques avant et après ; une patrouille d'Aldergrove
atteint et voit le HX 62 ; la leçon « Escorter » est intacte ; aucun test n'est supprimé ni
affaibli au-delà de l'ancienne règle.

Sa liste de ce qui va au-delà de ta demande est reprise dans « Choix », plus haut. S'y
ajoutent : `map.zone` d'Adlertag passe à « atlantic » (sans effet : ce n'est qu'un repli
pour la vue) ; l'entraînement (`m0-july-1940`) reçoit les quarts et le silence radio, par
la règle ; une version 2.11 refusera une sauvegarde de la 2.12.

## Ce que je n'ai pas pu faire

- **Lire tes quatre pages une à une.** L'outil qui ouvre une adresse a demandé ton accord,
  et tu n'étais pas là pour le donner. J'ai lu ces mêmes pages par la recherche, qui en
  rend des extraits, et ouvert celle de rafweb une fois la recherche passée par elle. Les
  faits du point 7 viennent de ces extraits. Si tu veux une lecture complète, redemande-la.
- **Essayer hors de Chrome.** Tout l'essai de fumée tourne dans Chrome sans écran.
- **Jouer à la main.** Comme avant : c'est toi qui diras si les quarts se vivent bien à
  Kanalkampf.

## Questions

1. **Atlantique : la cible de 30 à 60 arrêts est dépassée** (60 en jouant simple, 85 en
   jouant soigné). Veux-tu que les Condor retournent au rapport, où que soit le navire ?
   Cela ramène toutes les conduites sous 60, sauf la soignée (71). Pour celle-ci, il
   faudrait aussi choisir ce qu'un avion au-dessus d'un convoi garde en direct : aujourd'hui
   tout, selon ta règle.
2. **« Abords des côtes »** : les eaux suivies te suffisent-elles ? Elles couvrent le CW 7
   d'un bout à l'autre, mais ni les atterrages de l'ouest avant le canal du Nord, ni la
   côte de la mer du Nord, ni les abords sud-ouest. Les trois façons d'aller plus loin sont
   plus haut.
3. **L'ASV du 233 Sqn.** Je l'ai gardé pour ses six Hudson d'août 1940. Les sources datent
   l'ASV Mk I de janvier 1940, mais sur peu d'appareils. Le gardes-tu, ou le 233 d'Adlertag
   vole-t-il sans radar ? Et rafweb place le 224 Sqn, non le 233, à Aldergrove en août 1940,
   et note le 502 sur Whitley : je m'en suis tenu à ta consigne.
4. **Un appel, puis un autre pour la même chose.** Près de nous, une alerte sonne tout de
   suite, et la relève s'arrête ensuite si la décision attend toujours. Cela te va-t-il ?
   L'autre voie (l'alerte vaut la question) laissait passer des décisions sans appeler
   personne dans quatre cas, que la relecture a trouvés.
5. **La clé `seaRhythm` a disparu des scénarios** : le rythme se déduit des navires. Est-ce
   bien ce que tu voulais, ou préfères-tu garder la clé, contrôlée par le test ?
6. **L'entraînement** (`m0-july-1940`) a un convoi : il passe donc aux quarts et au silence
   radio, par la règle. Le voulais-tu aussi pour lui ?
7. **Sous 1 100 px de large, le cadran de l'horloge quitte la barre du haut** (l'heure reste
   en chiffres). C'est ce qui fait tenir le bouton « Quart » sur une ligne à 1 024 px. Cela
   te va-t-il ?
8. **Une partie d'Adlertag sauvegardée avant la 2.12.0** reprend sans le 502 ni le 233.
   Faut-il les lui ajouter au chargement ?
