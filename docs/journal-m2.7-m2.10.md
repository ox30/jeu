# Journal des lots M2.7 à M2.10

Journal de travail de la session autonome qui réalise les décisions de
`claude/decisions-audit-m2.md` (projet claude.ai). Il sert aussi de mémoire à la session :
ce qui est fait, les mesures, les choix et les problèmes, dans l'ordre où ils arrivent.

- Point de départ : `main`, version 2.6.1 (commit `95379ee`).
- Une branche par lot : `m2.7` depuis `main`, `m2.8` depuis `m2.7`, etc. Rien sur `main`.
- Les heures sont en UTC.

## M2.7 · Corrections et filet de sécurité

### 18 novembre 2026, 14 h 10 — départ

- Dépôt cloné, branche `m2.7` créée depuis `main` (`95379ee`).
- Machine de travail : 2 cœurs, 7 Go ; Node 22 ; Chrome 153 sans écran.
- Ordre de travail : le filet d'abord (joueur automatique au dépôt, lint, tests d'ordres au
  hasard, aller-retour de sauvegarde, test de fumée, intégration continue), puis la mesure
  de l'état de départ, puis les corrections.

### 18 novembre, jusqu'à 14 h 45 — le filet, et ce qu'il a trouvé

Posé avant toute correction (commit `52eeaa5`) :

- `tools/bot/` : le joueur automatique de l'audit, versé au dépôt. `air.mjs` et `sea.mjs` ne
  lisent que ce que la table montre (plots, repères, unités du joueur) et ne donnent que des
  ordres. `conducts.mjs` nomme les conduites et la matrice de mesure (32 lignes, 10 graines).
  `measure.mjs` joue la matrice, `perf.mjs` chronomètre les pas, `monkey.mjs` donne des
  ordres au hasard.
- `npm run lint` (ESLint 9, `tools/eslint.config.mjs`).
- `tests/fuzz.test.js` : ordres au hasard sur chaque scénario, avec sauvegardes et reprises ;
  la partie reprise doit être la partie sauvegardée, et aucune valeur ne doit devenir
  impossible (NaN, effectif négatif). 2 000 ordres par scénario dans `npm test`,
  10 000 dans `npm run fuzz` (le critère de la porte) et à chaque envoi.
- `tests/roundtrip.test.js` : aller-retour de sauvegarde par scénario avec chaque entité
  facultative (station mobile, formation avec rendez-vous, avion acheté, traînard).
- `tools/smoke/` : test de fumée dans Chrome sans écran (le tutoriel joué jusqu'à sa dernière
  étape ; pages, fiches et vues de chaque scénario ; version de développement et
  `dist/index.html` ouvert depuis le disque). `tools/smoke/fps.mjs` mesure les images par
  seconde à ×14 400.
- `.github/workflows/tests.yml` : lint, tests, ordres au hasard, construction de
  `dist/index.html` (et vérification qu'il est à jour), test de fumée, à chaque envoi.
- `tests/architecture.test.js` : `src/sim` n'importe que `src/core` ; aucun texte français en
  dur ; chaque clé de texte citée existe ; aucune règle morte dans `rules.json`.

Ce que le filet a trouvé avant qu'on change quoi que ce soit :

1. **B1**, retrouvé par les ordres au hasard dès le premier essai (`standingOrders`,
   `logistics.js`, sur une station mobile sans `minStock`).
2. **Les traînards étaient des convois incomplets** : créés sans `schedule` ni
   `rangeAlerted`. Sans plantage, mais la partie reprise différait de la partie
   sauvegardée (le champ manquant devenait `null` au chargement). Même famille que B1.
3. Le test de fumée a confirmé I8 : au tutoriel, le geste « glisser de Biggin Hill au
   raid » tombait sous la fiche du convoi.

Problèmes de mise au point, pour mémoire : le test de fumée lisait la position des unités
pendant l'animation de la caméra (il attend maintenant la fin de l'animation) ; il avançait
le temps par blocs de dix minutes et dépassait le premier contact radar (il s'arrête
maintenant au premier contact, comme le fait une alerte).

### Mesure de l'état de départ (version 2.6.1, commit `95379ee`)

Joueur automatique, 10 graines par ligne (`tools/bot/out/depart.jsonl`, non versé au dépôt).
Le joueur automatique réagit dans la minute et calcule ses interceptions sans erreur : il
mesure l'équilibre et les choix dominés, pas la difficulté ressentie.

| Scénario | Préréglage | Conduite | Victoires | Mesures |
| --- | --- | --- | --- | --- |
| Kanalkampf | Standard | rien | 0 sur 10 | convois non livrés |
| Kanalkampf | Standard | simple | 10 sur 10 | 55 abattus, 37 perdus |
| Kanalkampf | Standard | sans chasse | 10 sur 10 | aucun avion abattu, 8 perdus |
| Kanalkampf | Réaliste | simple | 10 sur 10 | 47 abattus |
| Kanalkampf | Réaliste | soigné | 10 sur 10 | 44 abattus |
| Adlertag | Standard | rien | 0 sur 10 | objectifs « bases » et « radars » tenus sans ordre |
| Adlertag | Standard | simple | 10 sur 10 | 144 abattus, chasse à 59 % |
| Adlertag | Standard | sans ravitaillement | 10 sur 10 | comme simple |
| Adlertag | Standard | 1 par raid | 6 sur 10 | 91 abattus |
| Adlertag | Standard | 2 par raid | 10 sur 10 | 129 abattus |
| Adlertag | Standard | 4 par raid | 3 sur 10 | chasse à 47 % |
| Adlertag | Réaliste | simple | 10 sur 10 | 149 abattus |
| Adlertag | Réaliste | soigné | 10 sur 10 | 142 abattus |
| 15 septembre | Standard | rien | 0 sur 10 | |
| 15 septembre | Standard | simple | 5 sur 10 | 39 abattus (objectif : 40) |
| 15 septembre | Standard | 2 par raid | 4 sur 10 | |
| 15 septembre | Standard | 4 par raid | 10 sur 10 | 52 abattus |
| 15 septembre | Réaliste | simple | 7 sur 10 | 45 abattus |
| 15 septembre | Réaliste | soigné | 1 sur 10 | 34 abattus : laisser les chasses libres coûte trop |
| 15 septembre | Réaliste | en masse | 9 sur 10 | 71 abattus, chasse à 73 % |
| Atlantique | Standard | rien | 0 sur 10 | 18,5 % de navires perdus ; 66 arrêts |
| Atlantique | Standard | simple | 7 sur 10 | 7,2 % perdus ; 3,5 U-Boote coulés ; 122 arrêts (96 à 147) |
| Atlantique | Standard | rester | 7 sur 10 | comme simple (Rester est la consigne par défaut) |
| Atlantique | Standard | chasser | 10 sur 10 | 4,1 % perdus ; 10 U-Boote coulés ; 94 arrêts (82 à 104) |
| Atlantique | Standard | deux avions achetés | 0 sur 10 | tonnage manqué 10 fois |
| Atlantique | Réaliste | rester | 4 sur 10 | 8,4 % perdus ; 116 arrêts |
| Atlantique | Réaliste | chasser | 9 sur 10 | 5,8 % perdus ; 94 arrêts |
| Atlantique | Réaliste | soigné | 9 sur 10 | 5,0 % perdus ; 99 arrêts |
| Campagne | Standard | simple | 1 sur 10 | le 15 septembre commence à 77-83 % de la chasse |
| Campagne | Réaliste | simple | 0 sur 10 | le 15 septembre commence à 60-66 % : objectif de chasse hors d'atteinte |
| Campagne | Réaliste | soigné | 0 sur 10 | idem |
| Campagne | Réaliste | simple, puis en masse le 15 | 0 sur 10 | idem (I1) |

Pas de simulation, une partie à la fois sur une machine au repos (`tools/bot/perf.mjs`) :

| Scénario | Pas de plus de 20 ms par partie | Pas le plus long |
| --- | --- | --- |
| Kanalkampf | 0 à 4 | 242 ms (le premier calcul de route) |
| Adlertag | 0 à 2 | 40 ms |
| 15 septembre | 0 | 2 ms |
| Atlantique, simple | 43 à 44 | 245 à 249 ms |
| Atlantique, chasser | 32 à 36 | 328 à 341 ms |

Les chiffres de pas de la matrice ci-dessus (jusqu'à 909 ms) ne valent rien : deux parties
tournaient côte à côte avec les tests. Seule la mesure au repos compte.

Images par seconde dans Chrome sans écran, 1 920 × 1 080, Atlantique au jour 40, ×14 400
(`tools/smoke/fps.mjs`) : 59,5 images/s sans fiche (image la plus longue : 50 ms),
59,9 images/s avec la fiche d'un groupe ouverte (33 ms).

### 18 novembre, 14 h 45 à 15 h 10 — corrections

- **B1, Code 1, Code 3** (`ce564f1`) : fabrique d'entités `src/sim/entities.js`
  (`declareFields`, `completeEntity`). Sites et convois y passent ; les escadrilles, groupes
  et U-Boote suivront quand un lot les touche. Garde-fou de la boucle : `src/ui/crash.js`.
  La sauvegarde garde maintenant l'état d'une station mobile.
- **I8** : `viewFrame` cadre dans la partie libre de la carte.
- **C11** : sept clés supprimées. **C12** : la fiche lit `rules.asw` (5 nœuds, la valeur
  de la simulation ; 7,6 nœuds était la vitesse de pointe, tenable une heure).
- **C14** : `formations.defaultName` dans `fr.json` ; sans nom, la simulation nomme la
  formation par son numéro (`F3`). L'interface propose toujours « Big Wing Duxford ».
- **C15** : `package.json` en 2.7.0.
- **H1** : type « Whitley » ajouté à `rules.patrols` (265 km/h, 9 h d'autonomie, 5 % de
  chances de couler). **Choix** : pas de radar ASV pour le 502 Sqn, comme avant (le drapeau
  `asv` de l'escadrille est resté absent) ; à revoir avec les radars du M2.8.
  **H2** : 10 Sqn RAAF à Oban. **H3** : `firstNumber` 102.
- **I1** (`2782564`) : `fighterShare` se mesure sur `world.fightersAtStart` (chasseurs
  présents au début, après report) ; la défaite « chasse saignée à blanc » suit la même
  mesure. **Choix** : la campagne continue de reporter la part de l'effectif théorique
  (`fighterEstablishmentShare`), sinon le report d'une bataille effacerait celui de la
  précédente. Le report est dit au briefing et entre dans la sauvegarde.

Mesure après I1, 10 graines : campagne en Réaliste, simple puis en masse le 15 septembre,
**5 sur 10** (0 sur 10 avant). Joué simplement de bout en bout, le 15 septembre reste perdu
en campagne (40 avions à abattre avec 60 % de la chasse) : c'est le réglage des seuils du
M2.10.

### 18 novembre, 15 h 10 à 15 h 45 — suite des corrections

- **C2** : `src/ui/summary.js` choisit les lignes du bilan. Une ligne s'affiche si un objectif
  du scénario la demande ou si le scénario contient la chose (raids, convois, dollars).
  Carburant et munitions consommés ne s'affichent que là où l'on peut perdre par panne de
  carburant (Kanalkampf, Adlertag).
- **N5** : chrono compté par la boucle d'affichage (`tickPlayClock`), arrêté à la fin du
  scénario, gardé dans la sauvegarde du navigateur et dans l'export (`meta.playClock`). Une
  image qui arrive après plus d'une seconde (onglet caché) compte pour une seconde.
- **C4** : `src/ui/keys.js`, lecture par `e.code`. **Choix** : Ctrl, Alt et Meta ne changent
  plus la vitesse (Ctrl+1 change d'onglet dans le navigateur).
- **C9, correctif** : `src/ui/hit.js`. L'unité en main gagne sur les autres unités sous le
  pointeur ; les poignées de sa route gardent la priorité. **Écart assumé** : la règle ne vaut
  que pour les unités (escadrille, convoi, groupe, aérodrome, point de rassemblement), pas
  pour un raid ou une installation sélectionnés, sinon un raid en main cacherait l'escadrille
  qui le combat. **Ajout** : un pointeur posé sur un symbole compte plus près que sur la plaque
  d'une voisine (avant, deux plaques qui se recouvraient étaient à égalité et la première
  dessinée gagnait).
  Limite connue jusqu'au M2.10 : une unité entièrement couverte par la plaque de l'unité en
  main ne se sélectionne plus d'un clic à cet endroit ; il faut cliquer sa propre plaque, la
  liste du tableau d'état, ou fermer la fiche (Échap). Les piles et onglets du M2.10 règlent
  ce cas.
- **N8, première partie** : la grille est une donnée du scénario ; elle est retirée de
  `hiver-atlantique.json`. Le réglage « Grille » et l'exemple « carré (J5) » ne s'affichent
  plus dans ce scénario.
- **Garde-fou** : la première erreur reste la cause affichée (une erreur de simulation casse
  souvent l'affichage dans la foulée). La reprise n'est proposée que pour une sauvegarde de
  la même partie : chaque partie reçoit un identifiant (`app.gameId`), gardé avec la
  sauvegarde. Il servira aux sauvegardes multiples du M2.9.
- Le test de fumée rejoue ces corrections dans la page. Vérifié qu'il échoue quand on coupe
  le correctif C9.

### Porte du M2.7

- **Aucun plantage en 10 000 ordres par scénario** : `npm run fuzz`, 15 h 35. Entraînement,
  Kanalkampf, Adlertag, 15 septembre, Atlantique : 10 000 ordres chacun, 16 à 22 sauvegardes
  reprises par scénario, aucun problème (4 min 8 s).
- **15 septembre gagnable en Réaliste** : campagne en Réaliste jouée simplement, puis le
  15 septembre en masse : 5 victoires sur 10 graines (0 sur 10 en 2.6.1).
  `tests/campaign.test.js` garde ce critère.
- `npm test` : 196 tests, tous verts. Lint vert. `dist/index.html` reconstruit (807 Kio).
  Test de fumée vert.
- GitHub Actions : **correction du 18 novembre, 16 h 40**. J'avais écrit ici « vert sur la
  branche » avant la fin du passage. En réalité le passage sur `67b6d41` a échoué : les
  commits de corrections avaient changé les sources sans reconstruire `dist/index.html`, et
  l'étape « dist à jour » l'a vu. Le passage sur `9282b26` est vert depuis 15 h 51. Depuis,
  `dist/index.html` est reconstruit avant chaque envoi.
- Pas de simulation et images par seconde : inchangés, comme attendu (C10 est au M2.8).
  Atlantique : 32 à 43 pas de plus de 20 ms par partie, le plus long 192 à 331 ms ;
  59,5 et 59,9 images/s à ×14 400.

### 18 novembre, 15 h 52 — plan du M2.8, écrit pendant la mesure du M2.7

Ordre de travail prévu, du plus indépendant au plus transversal :

1. **C10, calcul de route** (`src/sim/searoute.js`, `src/sim/uboatnav.js`) : `gridPath` passe aux
   tableaux typés et au tas `floatHeap` déjà présent ; les eaux fermées deviennent une grille
   calculée une fois, comme `landGrid`. Mesure : `tools/bot/perf.mjs`, cible zéro pas de plus
   de 20 ms.
2. **N6, jour et nuit au soleil** : nouveau `src/sim/sun.js` (déclinaison, équation du temps,
   hauteur du soleil ; jour au-dessus de −0,83°), heure du jeu = GMT+1 (`clockOffsetH` du
   scénario). `isDaylight(world)` et `isNight(world)` prennent une position. `daylightH`
   disparaît du scénario. Puis **C5** (attaque tirée au hasard dans la nuit, écart de 4 h
   gardé, attaques de jour très rares sur traînard ou navire isolé) et **N2** (ombre de la
   nuit, même fonction). Vérifier l'équilibre des scénarios aériens au joueur automatique.
3. **I3, grenades** : `charges` par groupe (40 par navire), consigne de grenadage plein ou
   économe, passes à blanc à vide, réarmement au port, fin de chasse sans durée réglable
   (contact perdu, U-Boot coulé ou endommagé, stock au tiers). `updateEscort` découpé.
   **N7** (attaque d'avion visible, une par sortie, repère d'avion qui lance la chasse à moins
   de 30 km) et **C13** (radar daté par groupe, portée courte).
4. **I4, avions achetés** : prix en dollars et en tonnes, délai et date d'arrivée, phrase du
   prêt-bail, prévision de tonnage ; curseur de part achetée retiré.
5. **Quarts** (idée A, I2, N10) : `src/sim/watch.js`. Six quarts par jour ; le rythme est une
   donnée du scénario (`rhythm: "watches"`). Les événements de mer du quart sont notés par
   `emit` ; à la relève, le rapport est construit depuis l'état du monde et ces notes, rangé
   dans `world.watchReports` (donc sauvegardé), et un événement `watchRelief` dit s'il faut
   s'arrêter. Entre deux relèves, seul arrêt : la première attaque d'un convoi dans la nuit.
   Interface : onglet « Signaux » du Journal, filtres, non lus, boutons de décision.
6. **N1, silence radio** : réglage `seaComms`. Eaux suivies = eaux fermées, approches des
   ports, couverture de surface des radars côtiers (**N4** : Glenarm, Castle Rock, Downhill,
   dates à vérifier). En haute mer : position estimée (dernier point sûr, route et vitesse
   prévues), ordres par radio à la relève, par avion au projecteur, ou par navire.
   Une fonction `shownPosition` unique pour la carte, les fiches et le joueur automatique.
7. Joueur automatique adapté (il lit les positions estimées), réglage des valeurs, mesures,
   tests de chaque nouveauté, relecture, livraison.

Choix déjà arrêtés (à confirmer par les mesures) :

- Une décision en attente arrête le jeu à la relève où elle apparaît. Si le joueur la laisse,
  elle reste dans « À décider » des rapports suivants sans arrêter de nouveau : sinon un
  convoi laissé volontairement sans escorte arrêterait le jeu toutes les quatre heures.
- Les consignes des groupes (Rester ou Chasser, grenadage) restent des ordres permanents
  appliqués sans nouvel ordre ; les changer en haute mer demande une transmission, comme tout
  ordre.

### 18 novembre, 15 h 56 — vérifications historiques pour le M2.8 (N4, H1)

**Radars d'Irlande du Nord (N4), station par station.** Sources : Frontline Ulster, « Radar in
Northern Ireland 1939-1945 » (d'après Colin Dobinson, *Building Radar*) ; liste des stations
Chain Home Low d'Air of Authority (rafweb.org) ; WartimeNI pour Downhill.

| Station | Type | Ce que disent les sources | Dans le scénario (10 janvier - 31 mars 1941) |
| --- | --- | --- | --- |
| Castlerock (59) | Chain Home, d'abord en version avancée | version avancée posée en novembre 1940, en service fin 1940 | en service dès le début ; voit les avions, pas les navires |
| Downhill (59A) | Chain Home Low | relevée en septembre 1940, construite en novembre 1940 ; la liste de janvier 1941 d'Air of Authority la dit encore « proposée » | en service dès le début (date exacte de mise en service incertaine) |
| Glenarm (60A) | Chain Home Low avancée | construite entre septembre 1939 et juillet 1940, améliorée en 1941 | en service dès le début |
| Greystone, Kilkeel, Roddens Port, Ballymartin | | plans ou chantier en 1941, en service en 1941-1942 | hors scénario |

Conclusion : les trois stations proposées par le document tiennent, toutes trois dès le
10 janvier ; aucune ne change d'état pendant le scénario. Seules Downhill et Glenarm, du type
« basse altitude » dérivé du radar de défense côtière, comptent pour la couverture de surface
des eaux suivies ; Castlerock ne voit que les avions. Positions approchées d'après les
références de grille de l'article : Castlerock 55,15° N 6,75° O ; Downhill 55,16° N 6,83° O ;
Glenarm 54,95° N 5,92° O. Réserve : ces sources sont secondaires et se contredisent sur
Downhill ; les archives n'ont pas été consultées.

**502 Sqn (H1).** Whitley depuis l'automne 1940, à Aldergrove jusqu'au 27 janvier 1941 puis à
Limavady ; patrouilles d'une dizaine d'heures, ce qui recoupe les 9 h retenues. Une page
d'histoire locale sur RAF Wick rapporte que le détachement du 502 y vole en janvier 1941
avec son radar ASV. **Choix** : le radar ASV sera donné au 502 Sqn au M2.8, avec le réglage de
la mer, et non au M2.7, pour ne pas changer l'équilibre en cours de mesure. Le déménagement à
Limavady le 27 janvier n'est pas représenté (la décision H1 ne le demande pas).

### 18 novembre, 16 h 25 à 16 h 50 — relecture par un agent neuf, et ses suites

Un agent qui n'avait pas vu le travail a relu le lot contre les critères du document
(`95379ee..9282b26`), en lecture seule, avec ses propres copies. Verdict : porte passée,
avec réserves ; aucun bug bloquant ; aucun test existant affaibli. Il a relancé le singe sur
neuf autres séries de 10 000 ordres (autres graines, trois préréglages) sans problème, et
vérifié que les nouveaux tests échouent bien sur la 2.6.1.

Ce qu'il a trouvé, et ce que j'en ai fait :

| Constat | Suite |
| --- | --- |
| **Important.** Un renfort (le 266 Sqn, le 14 août à Adlertag) n'entrait pas dans la référence de l'objectif de chasse : la part sautait de 0,77 à 0,85, et Adlertag devenait plus facile hors campagne (« 4 par raid », graine 3 : défaite en 2.6.1, victoire en 2.7.0). Je l'avais vu en lisant `schedule.js` pendant la mesure, sans l'avoir encore corrigé | **Corrigé** : une escadrille de chasse qui arrive s'ajoute à `fightersAtStart`. Hors campagne, la mesure redevient exactement celle de la 2.6.1. Test, et mesure refaite |
| Après une erreur, « Fermer » puis Espace : le jeu semblait reparti, l'heure ne bougeait plus | **Corrigé** : tant que l'erreur est là, le jeu reste en pause et toute reprise rouvre le message |
| Escadrille au sol en main, une autre survole son aérodrome : un clic ouvrait la fiche de l'aérodrome | **Corrigé** : l'aérodrome ne remplace l'escadrille en main que pour un glisser ; un clic choisit ce qui est sous le pointeur. Le cas d'un aérodrome sélectionné, que mon test croyait couvrir, l'est maintenant vraiment |
| Pavé numérique, verrouillage éteint : la flèche bas changeait la vitesse | **Corrigé** : le pavé ne compte que s'il tape des chiffres |
| Une partie de campagne sauvegardée en 2.6.1 gardait l'ancienne mesure (228 avions) | **Corrigé** : une partie est reprise sur un monde construit avec le report de la campagne ; une sauvegarde d'avant la 2.7 y prend son effectif du matin, plus les renforts arrivés depuis |
| Le briefing annonçait 60 % pour 133 avions sur 228 (58 %) | **Corrigé** : la part affichée est la part réelle |
| La fabrique ne complétait pas les entités à la reprise d'une sauvegarde | **Corrigé** : `fillMissingFields` à la reprise, test des champs par type |
| Tests : le train de l'aller-retour de Kanalkampf était refusé sans que le test le voie ; le groupe de soutien n'était pas exigé | **Corrigé** : chaque entité facultative doit exister au moment de la sauvegarde |
| Manquaient : une vraie sauvegarde 2.6.1 en entrée, le renfort, le pavé numérique, l'état après fermeture du message d'erreur | **Ajoutés** : `tests/fixtures/` (trois parties enregistrées par la 2.6.1), `tests/oldsaves.test.js`, et les cas correspondants |
| Fiche ouverte sur une fenêtre de 1 100 px ou moins : la vue Atlantique bute sur le zoom minimal et dépasse de 43 px sous la fiche | **Laissé**, limite connue (I8 demandait de faire court) |
| Le joueur automatique donne huit ordres qui ne sont pas dans `orders.js` | **Écart assumé**, voir ci-dessous |
| Journal : « GitHub Actions vert » écrit trop tôt ; README : « la campagne se gagne en Réaliste » trop affirmatif | **Corrigés** |

**Écart au document : les ordres du joueur automatique.** Le document demande qu'il ne donne
que « les ordres de `src/sim/orders.js` ». Dans le code, les ordres de l'interface vivent
dans plusieurs modules : `orders.js`, mais aussi `engagement.js` (attitude, réponses aux
questions, autorisation), `shipping.js` (achats), `formations.js`, `roster.js`,
`timetable.js`, `rally.js`, `mru.js`. Le joueur automatique appelle ces mêmes fonctions, celles
que l'interface appelle, et rien d'autre : il ne modifie jamais le monde à la main. Réunir
tous les ordres derrière une seule entrée va avec la table d'actions du M2.9.

**Limites connues du M2.7, à dire à Florian :**

- Une unité entièrement couverte par la plaque de l'unité en main ne se choisit pas d'un clic
  à cet endroit (piles et onglets du M2.10).
- Vue Atlantique sur petite fenêtre avec la fiche ouverte (ci-dessus).
- Le 15 septembre en campagne ne se gagne qu'en engageant en masse (seuils du M2.10).
- Les tests des touches, du clic, du cadrage et du chrono portent sur des fonctions pures ;
  leur branchement dans la page n'est tenu que par le test de fumée, qui tourne à chaque
  envoi mais pas dans `npm test`.

### Mesure après le M2.7 (18 novembre, 16 h 55)

Même matrice que la mesure de départ : 32 lignes, 10 graines, soit 320 parties
(`tools/bot/out/m2.7-final.jsonl`). Comparaison partie par partie avec la 2.6.1 (issue,
avions abattus et perdus, navires et U-Boote coulés, arrêts, carburant) : **30 lignes sur 32
sont identiques à la partie près.** Les deux qui changent :

| Ligne | 2.6.1 | 2.7.0 | Cause |
| --- | --- | --- | --- |
| Campagne, Réaliste, simple puis en masse le 15 septembre | 0 sur 10 | **5 sur 10** | I1 : l'objectif de chasse se mesure sur les chasseurs présents au début |
| Atlantique, Réaliste, soigné (Chasser et couverture aérienne) | 9 sur 10 ; 5,0 % de navires perdus ; 99 arrêts | 9 sur 10 ; 5,7 % ; 111 arrêts | H1 et H2 : le Whitley du 502 Sqn et le 10 Sqn RAAF à Oban changent la couverture aérienne |

Les campagnes jouées simplement ou « soigné » restent perdues le 15 septembre (40 avions à
abattre), mais plus jamais sur l'objectif de chasse.

Le reste est inchangé, comme il se doit pour un lot de corrections : Kanalkampf gagné sans
chasse, Adlertag gagné sans ravitaillement, « Chasser » qui gagne 10 fois sur 10 dans
l'Atlantique, 96 à 147 arrêts par partie d'Atlantique en jouant simplement. Ce sont les
sujets des lots M2.8 et M2.10.

Une première mesure, avant la correction du renfort d'Adlertag, donnait « 4 par raid » à
4 sur 10 au lieu de 3 : c'est elle qui a montré l'effet de bord relevé par la relecture.

État final du lot M2.7 (18 novembre, 17 h 00) : 205 tests verts (156 en 2.6.1, 49 ajoutés),
lint vert, `npm run fuzz` vert, test de fumée vert, `dist/index.html` reconstruit.

## M2.8 · La mer au rythme des quarts

Branche `m2.8`, partie de `m2.7` (`04333ee`). La mesure « avant » du lot est la mesure finale
du M2.7 (`tools/bot/out/m2.7-final.jsonl`).

### 18 novembre, 16 h 55 à 17 h 22 — C10, calcul de route sans à-coups

`gridPath` réécrit : tableaux typés réutilisés d'une recherche à l'autre (tampons datés),
coûts entiers (70 et 99), tas binaire à priorités flottantes, grille des eaux fermées
calculée une fois par monde (`closedRaster`), grille de terrain à trois classes (mer, terre,
côte) qui rend `isLand` exact et environ douze fois plus rapide, redressement du chemin par
points tournants. Les grilles se construisent à la création du monde, plus au premier calcul.

| Mesure (`tools/bot/perf.mjs`, machine au repos) | 2.7.0 | Après C10 |
| --- | --- | --- |
| Routes typiques de l'Atlantique | 5 à 204 ms | 0,3 à 10 ms |
| Pas de plus de 20 ms par partie d'Atlantique | 32 à 44 | 0 (six parties) |
| Pas le plus long, Atlantique | 192 à 341 ms | 5,8 à 13,2 ms |

`tests/searoute.test.js` (5 tests) : chemin optimal contre un Dijkstra de référence, routes
en mer, U-Boote hors des eaux fermées, longs trajets sous 20 ms, grille de terre contre les
côtes. Le test existant `tests/seaways.test.js` (route au plus 5 % plus longue que la
distance du champ de port) a d'abord échoué avec le redressement par points tournants
(6,1 %) : j'ai affiné le redressement (recherche par dichotomie le long de chaque tronçon)
plutôt que de toucher au test.

**Autre à-coup trouvé en mesurant (17 h 50).** Au 15 septembre et à Adlertag, un pas de 40 à
80 ms revenait au même instant quelle que soit la graine : la grille de ce que voit
l'Observer Corps se construisait au premier raid au-dessus des terres. Elle est construite
avec le monde. Les scénarios aériens gardent des pas de 5 à 12 ms.

### 18 novembre, 17 h 22 à 17 h 50 — N6, C5, N2 : jour et nuit au soleil

- **N6.** `src/core/sun.js` (déclinaison, équation du temps, hauteur du soleil) et
  `src/sim/daylight.js` : `isDaylight(world, x, y)` et `isNight(world, x, y)`, jour au-dessus
  de −0,83°, horloge du jeu à GMT+1 (`clockOffsetH` du scénario, 1 par défaut). Patrouilles,
  vue des escadrilles et des navires, guetteurs, Condor, attaques des U-Boote et fiches
  posent tous la question au même endroit, à la position de l'unité. Les heures fixes
  disparaissent des données (`daylightH`, `dayFromH`, `dayToH`, `nightFromH`, `nightToH`).
  Coût : 0,11 µs par question, aucun effet mesurable sur la durée d'un pas (3,9 µs en
  moyenne dans l'Atlantique, comme avant).
- **Tests touchés, sans les affaiblir.** Les tests d'autorisation du 15 septembre posaient
  un raid à 06 h 00, heure d'ouverture du scénario : le soleil ne se lève plus qu'à 06 h 36
  sur le Kent ce jour-là, l'escadrille ne voyait donc plus le raid à 15 km. Ils commencent
  maintenant au lever du soleil ; leurs assertions sont inchangées. Le test « les jours
  d'hiver sont courts » vérifie à présent la nuit de seize heures de la mi-janvier à 56° N
  et le coucher du soleil plus tardif à l'ouest.
- **C5.** Un U-Boot en place et prêt (quatre heures après sa dernière attaque) attaque à son
  heure : de nuit, une heure d'attente en moyenne (`attackPerHourNight`) ; de jour, presque
  jamais contre un convoi (0,01 par heure), plus volontiers contre un traînard ou un convoi
  réduit à deux navires (0,12 par heure). Avant, tout tombait à la minute où la nuit
  commençait, puis toutes les quatre heures, et la meute attaquait d'un seul coup.
- **N2.** `src/render/night.js` : là où le soleil est couché, la table s'assombrit, avec un
  dégradé pendant le crépuscule civil (de −0,83° à −6°). Réglage d'affichage « Ombre de la
  nuit sur la carte », activé par défaut. La hauteur du soleil vient de la fonction de la
  simulation ; `tests/night.test.js` vérifie point par point, sur deux jours, que l'ombre
  dessinée est la nuit de la simulation.

**Écart au document (N2).** Le document prévoit « un contour de quelques centaines de points
par image ». J'ai d'abord étiré une petite image avec le lissage du navigateur : mesuré dans
Chrome sans écran, ×14 400 tombait à 42-52 images par seconde. L'ombre est donc calculée
tous les 32 pixels, interpolée par le code en carrés de 4 pixels et étirée sans lissage :
**59,3 et 59,4 images par seconde** (59 et 59,9 sans ombre, sous la même charge). L'intention
est tenue : même fonction que la simulation, dégradé au crépuscule, sans effet sur ×14 400.

**Effet de N6 et C5 sur l'équilibre** (`tools/bot/out/m2.8-n6c5.jsonl`, mêmes 32 lignes,
10 graines, comparées à la mesure finale du M2.7 par `tools/bot/compare.mjs`) :

| Ligne | M2.7 | N6 et C5 |
| --- | --- | --- |
| 15 septembre, toutes conduites | — | 70 parties identiques à la partie près : les raids tombent en plein jour |
| Kanalkampf, toutes conduites | 0, 10, 10, 10, 10 sur 10 | mêmes victoires ; parties différentes (aube et crépuscule déplacés) |
| Adlertag, simple, Standard | 10 sur 10 | 9 sur 10 |
| Adlertag, 1 par raid | 6 sur 10 | 4 sur 10 |
| Adlertag, 2 par raid | 10 sur 10 | 9 sur 10 |
| Adlertag, 4 par raid | 3 sur 10 | 1 sur 10 |
| Adlertag, simple, Réaliste | 10 sur 10 | 8 sur 10 |
| Adlertag, soigné, Réaliste | 10 sur 10 | 10 sur 10 |
| Atlantique, rien | 0 sur 10, 18,5 % de navires perdus | 0 sur 10, 18,5 % |
| Atlantique, simple ou Rester, Standard | 7 sur 10, 7,2 % | 9 sur 10, 6,2 % |
| Atlantique, Chasser, Standard | 10 sur 10, 4,1 % | 10 sur 10, 3,2 % |
| Atlantique, Rester, Réaliste | 4 sur 10, 8,4 % | 9 sur 10, 7,1 % |
| Atlantique, Chasser, Réaliste | 9 sur 10, 5,8 % | 10 sur 10, 5,4 % |

Lecture : à Adlertag le jour d'août est plus court d'une heure et quart (05 h 45 à 20 h 25
à l'horloge, au lieu de 05 h à 21 h), ce qui coûte une à deux victoires sur dix ; le réglage
des seuils est de toute façon l'affaire du M2.10 (I5). Dans l'Atlantique, la nuit est plus
longue (seize heures au lieu de treize), mais les attaques ne tombent plus toutes les quatre
heures pile : l'attente tirée au sort (une heure en moyenne) en retire à peu près une par
nuit et par bateau, et le scénario devient un peu plus facile. Je règle l'Atlantique à la
fin du lot, une fois les grenades, les quarts et le silence radio en place, comme le
demande le document.

### 18 novembre, 17 h 50 à 18 h 25 — I3, N7, C13, I4

- **I3, grenades** (`b092f6a`). 40 par navire (120 ou 160 par groupe), refaites au port avec
  le mazout. Consigne de grenadage : plein (dix par passe) ou économe (cinq, avec 0,6 fois
  la chance de couler et 0,75 fois celle de toucher). À vide, passes à blanc : le U-Boot
  reste en plongée, sans rien risquer ; événement `escortChargesOut`, pas de retour forcé.
  La chasse s'arrête seule : U-Boot coulé ou touché, contact perdu (après 45 minutes de
  recherche sur place), ou stock tombé au tiers gardé pour le convoi. La durée de chasse
  réglable disparaît. `updateEscort` découpé en huit fonctions. Jauge « Grenades 96/160 »
  sur la fiche, dans la barre et dans le rapport d'attaque.
- **Choix d'I3 à signaler.**
  1. « La chasse s'arrête quand le U-Boot est endommagé » ne tenait pas tel quel : le groupe
     ré-attaquait à la minute suivante le bateau touché, encore sous lui. Un U-Boot touché
     qui rentre n'est donc plus attaqué par les groupes (il est hors de combat ; un avion
     peut encore le couler), et il est réparé pendant sa remise en état. La règle
     `damagedKillFactor` devient sans objet et disparaît.
  2. « Contact perdu » : après la perte du contact, ou une fois arrivé sur un repère, le
     groupe cherche 45 minutes (`searchS`), puis rentre. Un trajet vers un repère est borné
     par une fois et demie le temps en ligne droite, plus la recherche.
  3. La fin de route « Chasser sur place (3 h) » devient « Chercher un U-Boot sur place » :
     une recherche de 45 minutes, puis le groupe attend. Elle n'a plus grand intérêt ; je la
     garde plutôt que de retirer un ordre que le document ne cite pas.
  4. Un groupe qui n'a plus que sa réserve refuse l'ordre « Chasser ce contact », avec un
     message ; il riposte encore près du convoi.
  5. Deux tests décrivaient la durée de chasse réglable (`naval.test.js`) : ils décrivent
     maintenant la règle décidée (trajet et recherche). Ce n'est pas un affaiblissement :
     le comportement testé a changé par décision.
- **N7, attaques d'avions visibles** (`8af1777`). Une attaque par sortie, à moins de 4 km ;
  ratée, elle donne l'événement `aircraftAttack` (« grenade un U-Boot en plongée, résultat
  inconnu ») ; ensuite l'avion fait encore plonger. Le repère d'un avion à moins de 30 km
  d'un convoi lance la chasse du groupe en « Chasser » le plus proche.
- **C13, radar d'escorte**. Donnée datée par groupe (`radarFrom`) : EG 1 le 1er mars 1941,
  EG 3 le 15 mars ; le poste est monté au port. Portée 2 km contre un U-Boot en surface
  (4,8 km avant), de nuit comme de jour ; plus de détection de périscope.
  **Choix :** dans le modèle, un U-Boot qui piste reste à 14 km du convoi et n'entre presque
  jamais dans 2 km d'un escorteur : pour que ce radar pèse, comme le Vanoc contre l'U-100, un
  groupe équipé repère plus sûrement l'U-Boot qui vient d'attaquer en surface (0,6 au lieu
  de 0,35). La portée de 2 km est « de l'ordre du kilomètre » tout en dépassant les vigies
  de nuit (1,5 km).
- **I4, avions achetés** (`0fe5feb`). Prix en dollars et en tonnes, délai et date d'arrivée,
  phrase du Congrès, prévision de tonnage (`tonnageForecast`), curseur de part achetée
  retiré : les convois partent chargés à plein tant que la réserve paie, puis en partie,
  puis sur lest. Constat utile pour l'équilibre : les 520 millions ne paient pas tous les
  convois d'avant le vote (il en faudrait environ 706) ; sans le curseur, la réserve
  s'épuise fin février, et l'achat d'un Catalina avance cette date d'un convoi et demi.

État à 18 h 25 (heures UTC, lues sur les commits) : 244 tests verts, lint vert, `dist/index.html` reconstruit (826 Kio).
Reste du lot : quarts et rapports (I2, A, N10), silence radio (N1), radars d'Irlande du
Nord (N4), ASV du 502 Sqn, joueur automatique adapté, réglage, mesures, relecture.

### 18 novembre, 18 h 25 à 19 h 07 — quarts (I2, A, N10), silence radio (N1), radars (N4)

**Quarts, simulation** (`src/sim/watch.js`, `ec676dd`). Scénario au rythme des quarts
(`seaRhythm: "watches"`, l'Atlantique seulement). Les événements de mer sont notés ; à chaque
relève un rapport s'écrit dans `world.watch.reports` (donc sauvegardé) ; l'événement
`seaStop` arrête le jeu : à la relève quand une décision nouvelle attend, selon le réglage
`watchStops` (décision, 8 h et 20 h, chaque relève), et entre deux relèves pour la première
attaque d'un convoi dans la nuit (de midi à midi, traînards comptés avec leur convoi).

**Choix des quarts, à signaler.**
1. *Décisions* : convoi sans escorte à portée d'un groupe prêt au port (hors des eaux
   fermées) ; groupe ou navires en attente d'ordres ; grenades épuisées ; repères U-Boote sur
   la route d'un convoi dans les 24 h. Le retour d'un groupe à court de mazout reste
   automatique (sinon il tomberait à sec entre deux relèves) : la décision porte alors sur
   son convoi, redevenu « à portée, sans escorte ».
2. *Repères sur la route : demandé une fois par tracé de route.* Première version : un arrêt
   par repère nouveau, soit 54 arrêts de relève sur les repères seuls (41 relèvements radio,
   13 U-Boote vus) et 90 arrêts par partie, hors cible. Le joueur qui garde sa route a
   répondu ; une nouvelle route est une nouvelle question. Mesure après : **46 à 55 arrêts
   par partie** (graines 1 à 3, jeu simple), dont 22 convois à escorter, 11 repères sur une
   route et 15 à 23 premières attaques de nuit.
3. *Un rapport sans événement ni décision nouvelle n'est pas « non lu »* : sinon le compteur
   de l'onglet Signaux monte de six par jour.
4. *Taille* : les rapports d'une partie entière pèsent environ 430 Kio en JSON (parties vides
   omises, lecture par `fullReport`). À retenir pour les cinq sauvegardes du M2.9 :
   compresser, ou ne garder les rapports qu'une fois.
5. Le test « un U-Boot vu par une patrouille ramène l'Atlantique à ×1 » décrit maintenant la
   décision : dans l'Atlantique l'observation va au rapport de quart ; là où les alertes
   restent en direct (Kanalkampf), elle ramène toujours le jeu à ×1.

**Quarts, interface** (`src/ui/watchPanel.js`). Onglet « Signaux » du journal : rapports par
jour puis par quart, une ligne repliée chacun, filtres (tout, à décider, attaques et pertes,
U-Boote, un convoi ou un groupe), non lus marqués et comptés sur l'onglet, clic qui déplie,
centre la carte et sélectionne l'unité. À l'arrêt d'une relève, la page du rapport s'ouvre
avec « À décider » en tête et le bouton qui répond (« Envoyer EG 2 (la Clyde) », « Rentrer
réarmer », « Voir »). L'arrêt est une pause : la vitesse n'est pas touchée, « Reprendre »
repart à la vitesse d'avant (vérifié dans Chrome sans écran). À la première attaque de la
nuit : alerte « Convoi attaqué », en pause.

**Silence radio, simulation** (`src/sim/comms.js`, `eab7aa2`). Réglage `seaComms` : direct en
Arcade, silence en Standard et en Réaliste. Eaux suivies : eaux fermées (le canal
Saint-Georges en fait partie, testé), approches des ports (80 km : la tête de route des HX
est à 60 km d'Halifax), couverture de surface des radars. Ordres par `sendOrder` : direct,
projecteur d'un avion en vue, radio à la relève suivante, ou confié à un groupe.

**Choix du silence radio, à signaler.**
1. *L'estimation.* Dans la simulation un convoi suit exactement sa route : une estime « route
   et vitesse prévues » serait toujours juste. Pour que l'information reste imparfaite,
   l'estimation est la position plus une dérive qui croît comme la racine du temps depuis le
   dernier point sûr (5 km × √heures : 25 km après un jour, 60 km après six), dans une
   direction tirée une fois pour ce point sûr à partir de la graine, du navire et de l'heure —
   jamais des dés de la simulation, qui ne change donc pas selon le réglage. Le repère ne
   bouge qu'aux relèves ; le cercle dessiné (deux fois la dérive, plus le chemin fait depuis
   la relève) contient toujours le navire (testé sur quatre jours).
2. Un groupe parti chasser sur sa consigne est cru avec son convoi.
3. Une route passée au projecteur ou par un groupe n'est pas un signal radio : le B-Dienst
   ne peut pas la lire (`quietRoute`). La route d'appareillage reste lisible, comme avant.
4. « Demander la position » : `noteConvoy` (le BdU apprend où passe le convoi) et rappel des
   bateaux en patrouille à moins de 150 km.
5. Les scénarios sans quarts ne changent pas, quel que soit le réglage (testé à Kanalkampf).

**N4.** Castlerock, Downhill, Glenarm ajoutés à l'Atlantique ; seules Downhill et Glenarm
(`surfaceKm: 50`) comptent pour les eaux suivies : le nord d'Inishowen devient suivi.

État : 264 tests verts. Reste : interface du silence radio (repères estimés sur la carte,
fiches, ordres par `sendOrder`), ASV du 502 Sqn, joueur automatique, réglage, mesures,
test de fumée des nouveautés, README, relecture, livraison.

### 18 novembre, 19 h 07 à 19 h 20 — interface du silence radio, joueur automatique, aide

- **N1, interface** (`5159fe0`). Sur la carte, un navire en haute mer est dessiné à sa position
  estimée : contour en tirets, « ? », cercle d'incertitude. La fiche dit « Dernier point :
  14 h, Sunderland du 10 Sqn RAAF », la voie de chaque ordre (radio à la relève, projecteur,
  groupe porteur), les ordres en attente (annulables) et « Demander la position ». Tous les
  ordres de mer de l'interface passent par `sendOrder`.
- **502 Sqn** : radar ASV (`asv: true`), qui donne un point sûr de nuit à 25 km.
- **Joueur automatique** : il lit `shownPosition` et ordonne par `sendOrder` ; conduites
  `rester-econome`, `chasser-econome`, `soigne` (chasse, couverture aérienne, réarmement).
- **Aide** de l'Atlantique réécrite ; test de fumée `watches` (rapport de quart, arrêt,
  « Reprendre », onglet Signaux, fiche d'un navire estimé) ; quatre tests de l'onglet Signaux.

### 18 novembre, 19 h 20 à 21 h 30 — réglage de la mer : pourquoi Chasser gagnait toujours

**Mesure après toutes les mécaniques** (`m2.8-a`, 10 graines) : arrêts 39 à 62 par partie ;
Standard : Rester 8/10 (6,8 % de pertes), Chasser **10/10** (4,9 %), soigné **10/10** ;
Réaliste : Rester 7/10, Chasser 8/10, soigné 8/10. La porte n'est pas franchie : en Standard,
Chasser gagne à coup sûr, comme avant le lot.

**Ce que les mesures ont montré**, dans l'ordre où je l'ai compris :

1. *Le contact perdu n'existait pas.* Après une passe « contact perdu », le groupe cherchait
   sur place, et la recherche retrouvait le U-Boot à la minute suivante, à coup sûr (il était
   dessous). Toutes les chasses finissaient donc par un U-Boot coulé ou endommagé. Corrigé
   (`d4bfa6c`) : le bateau descend profond ; la recherche de 45 minutes ne le retrouve qu'une
   fois sur trois (`pRegain` 0,35, après `regainS` 15 minutes). C'est la règle du document
   (« la chasse s'arrête seule : contact perdu… ») enfin appliquée.
2. *Un groupe en « Rester » courait pour rien.* Les U-Boote suivent un convoi à 14 km sur
   l'arrière et attaquent de là. Un groupe en Rester qui voyait l'attaquant partait, était
   rappelé à 15 km de son convoi (lequel s'éloigne) avant d'arriver, puis mettait plus d'une
   heure à rattraper : 99 contre-attaques sur 130 par partie finissaient « trop loin », et le
   convoi restait sans escorte pendant ce temps. Mesure révélatrice : en repérant *moins*
   souvent l'attaquant (0,20 au lieu de 0,35), Rester perdait *moins* de navires (6,0 % contre
   6,6 %). Corrigé (`d4bfa6c`) : un groupe en Rester ne part que sur un U-Boot qu'il peut
   atteindre avant d'être rappelé (`willCounter` : temps de route, position future du
   convoi) ; l'attaquant aperçu plus loin est seulement forcé à plonger. Conséquence à
   signaler : en Rester, un groupe ne coule presque plus rien (0,2 U-Boot par partie) et ne
   consomme presque pas de grenades ; il protège par sa présence (tirs moins précis, U-Boote
   repoussés).
3. *Essais sans effet net* (10 graines, Standard, Chasser puis Rester) : chances de couler et
   d'endommager abaissées d'un tiers (5,9 % / 7,2 % avant le point 2, 5,2 % / 6,2 % après) ;
   contact perdu deux fois plus fréquent (4,6 % / 6,9 %) ; U-Boote qui réattaquent plus vite un
   convoi découvert (5,3 %, retiré). Chasser restait à 9 ou 10 sur 10. Avec 10 graines,
   l'écart-type de la moyenne est d'environ 0,5 point : des effets de cette taille ne se
   voient pas.
4. *La vraie cause : un U-Boot coulé ne revenait jamais.* Le scénario a six U-Boote pour
   80 jours. Compte par partie (3 graines) : Chasser 63 attaques (dont 14 sur convoi sans
   escorte), 3,3 U-Boote coulés, 6,4 endommagés, 7 repoussés ; Rester 97 attaques (dont 26
   sans escorte : la partie de la traversée où aucun groupe n'a encore rejoint), aucun coulé,
   17,7 repoussés. Les deux conduites renvoient autant de bateaux à leur base (17 par partie),
   mais ceux que Chasser coule ne reviennent pas : à mi-partie, la moitié de la flotte ennemie
   a disparu pour de bon. Aucun réglage des grenades ne pouvait compenser cela.

**Décision : le BdU remplace ses pertes** (`uboats.replaceDays`, 21 jours). Un bateau coulé
est remplacé par un autre, qui appareille des bases de Gascogne trois semaines plus tard pour
la même zone ; un bateau endommagé ou repoussé revient déjà après 14 jours de remise en état.
Couler soulage donc le joueur un peu plus longtemps qu'endommager, sans vider la mer. C'est
un ajout au document (il ne parle pas des remplacements), fait pour tenir sa cible « ni Rester
ni Chasser ne gagne à coup sûr » ; il est aussi plus juste : début 1941, les bateaux neufs
arrivaient chaque mois. Le joueur n'en est pas averti (un bateau neuf est un inconnu de plus),
mais l'aide le dit. Six tests (`tests/uboatreplace.test.js`).

Au passage : l'heure de la dernière attaque d'un U-Boot valait « moins l'infini », qu'une
sauvegarde transformait en zéro ; remplacé par un nombre (`LONG_AGO`), et réparé au
chargement des anciennes parties.

**Refonte prévue par le document, faite ici** (`7deb844`) : `eventMessage`, un `switch` de
84 cas, devient `src/ui/messages.js`, une table par famille, les mêmes familles que les
rapports de quart. Vérifié identique à l'ancien sur 15 000 événements de parties réelles
(115 types) et 246 cas construits.

### 18 novembre, 21 h 30 à 22 h 40 — fin du réglage de la mer, outils

Trois corrections trouvées en regardant des parties de près (`83e8c33`) :

- *Engagements vides.* Un groupe en « Rester » encore loin de son convoi (il le rejoint)
  ouvrait un engagement sur chaque U-Boot croisé, puis devait rompre aussitôt : environ
  150 rapports d'engagement vides par partie. Il signale maintenant le contact sans attaquer
  (`willCounter` s'applique aussi au convoi qu'il va rejoindre).
- *Contact vu puis perdu à chaque minute.* Un groupe « en attente d'ordres » au-dessus d'un
  U-Boot endommagé annonçait le même bateau vu, perdu, vu… Il tient son contact comme les
  autres ; un bateau descendu profond échappe à l'ASDIC (contact perdu, dernière position
  gardée sur la table).
- *Chances par passe.* `pKillPerShip` 0,012 et `pDamagePerShip` 0,02 (0,03 et 0,04 avant),
  soit 4,8 % et 8 % par passe pour quatre navires : une chasse dure quatre passes en moyenne,
  environ une sur deux aboutit, et le stock de grenades limite enfin les chasses.

**Seuil de victoire.** Avec ces mécaniques et le seuil de 8 % de pertes : Standard, Rester
9/10, Chasser 10/10, soigné 10/10 ; Réaliste 5/10, 5/10, 8/10. Deux conduites gagnaient
encore à coup sûr en Standard. Le seuil passe à **7,5 %** (`105af9d`) : c'est un écart au
scénario d'origine (8 %), fait pour tenir la cible « aucune conduite sûre de gagner ».

**Outils** (`253833e`) : le test d'ordres au hasard donne aussi les ordres de mer du 2.8
(ordres par radio, annulation, ordre confié à un groupe, « Demander la position ») ; la mesure
d'images ferme les rapports de quart qui s'ouvrent ; le test de fumée choisit un groupe qui
n'est pas en carénage. 10 000 ordres par scénario : aucun problème.

### 18 novembre, 22 h 40 à 23 h 30 — relecture du M2.8 par un agent neuf, et ses suites

Un agent qui n'avait pas vu le travail a relu la branche contre les critères du document.
Douze constats, tous corrigés (`8c55e84`, dix tests dans `tests/review28.test.js`) :

1. Un groupe de soutien contournait le silence radio : on pouvait y faire entrer un groupe en
   haute mer, et le chef passait ses ordres aux autres sans délai. Entrer dans un groupe de
   soutien demande maintenant une voie directe (`joinProblem` : « silence »), et un membre ne
   suit son chef que s'il l'entend (voie directe, à moins de 20 km, ou à la relève).
2. Des ordres donnés par une voie directe étaient annoncés « échoués » alors qu'ils étaient
   exécutés (vitesse, zigzag, allure du convoi).
3. Modifier la route d'un convoi à la main ne comptait pas comme un nouveau routage : la
   décision « repère sur la route » ne revenait pas.
4. La fiche donnait la distance restante et l'heure d'arrivée depuis la position vraie, et la
   carte dessinait les marques de chasse à la position vraie : tout part maintenant de la
   position montrée, avec « ≈ » quand c'est une estimation.
5. Un ordre confié à un groupe restait en attente pour toujours si ce groupe ne rejoignait
   plus le convoi : il repart par radio, et le journal le dit.
6. Après un contact perdu puis retrouvé, une chasse pouvait continuer sous le tiers du stock
   de grenades : la réserve est tenue.
7. Le B-Dienst pouvait lire une route passée au projecteur ou par un navire.
8. À grande vitesse, l'arrêt d'une relève arrivait une image trop tard (jusqu'à une heure de
   jeu) : `seaStop` interrompt l'image en cours.
9. Un groupe qui escorte était dessiné loin de son convoi (deux estimations différentes) : il
   partage l'estimation et le point sûr de son convoi.
10. Les achats d'avions manquaient au rapport de quart (événements émis par un ordre, entre
    deux pas) : le rapport écoute les événements à leur émission.
11. Trois erreurs dans les textes d'aide (consignes, « Demander la position », délai radio).
12. De la ponctuation en dur dans le panneau des quarts, passée dans `fr.json`.

Laissé tel quel, à signaler : « Demander la position » ne coûte rien à un groupe seul (le
relèvement donné au BdU ne sert que contre un convoi) ; le réglage « Arrêt aux relèves »
était encore lu dans les réglages du joueur, ce que le M2.9 corrige (réglage de la partie).

Trouvé ensuite en jouant : l'onglet « Signaux » restait visible dans les scénarios sans quarts
(la règle CSS `.tabs` l'emportait sur `hidden`), corrigé (`f25663c`).

### Mesure après le M2.8 (19 novembre, 0 h 10)

Joueur automatique, 10 graines par conduite. Les batailles aériennes ont été mesurées au
commit `10d0321` (`m2.8-final`) ; l'Atlantique et Kanalkampf ont été remesurés après les
corrections de la relecture, au commit `8c55e84` (`m2.8-final2`, 150 parties).

**Atlantique** (avant : `m2.7-final`) :

| Préréglage | Conduite | Victoires | Navires perdus | U-Boote coulés | Arrêts par partie |
| --- | --- | --- | --- | --- | --- |
| Standard | rien | 0 → 0 sur 10 | 18,5 → 18,5 % | 0 → 0 | 66 → 55 (51 à 59) |
| Standard | simple (= Rester) | 7 → 9 sur 10 | 7,2 → 5,6 % | 3,5 → 0,0 | 122 → 49 (44 à 59) |
| Standard | Chasser | 10 → 9 sur 10 | 4,1 → 5,5 % | 10,0 → 3,0 | 94 → 52 (46 à 56) |
| Standard | Chasser, grenadage économe | — → 8 sur 10 | 6,4 % | 2,8 | 51 (42 à 56) |
| Standard | soigné (Chasser, avions, réarmement) | — → 9 sur 10 | 5,3 % | 3,0 | 53 (47 à 57) |
| Standard | deux avions achetés le premier jour | 0 → 3 sur 10 | 7,2 → 5,6 % | — | 49 (44 à 59) |
| Réaliste | Rester | 4 → 5 sur 10 | 8,4 → 8,3 % | 3,8 → 0,1 | 116 → 56 (47 à 61) |
| Réaliste | Chasser | 9 → 2 sur 10 | 5,8 → 8,1 % | 9,4 → 2,7 | 94 → 53 (47 à 60) |
| Réaliste | soigné | 9 → 7 sur 10 | 5,7 → 7,2 % | 9,5 → 3,6 | 111 → 54 (49 à 58) |

**Batailles aériennes** (elles ne changent que par le jour et la nuit au soleil) : Kanalkampf
inchangé (rien 0/10, simple 10/10, sans chasse 10/10, Réaliste 10/10) ; Adlertag Standard
simple 10 → 9/10, 1 par raid 6 → 5/10, 2 par raid 10 → 9/10, 4 par raid 3 → 2/10, Réaliste
10/10 ; 15 septembre inchangé (Standard simple 5/10, 4 par raid 10/10,
Réaliste simple 7/10, soigné 1/10, en masse 9/10) ; campagne en Réaliste « en masse le 15 »
5 → 4/10. Les règles d'équilibre des batailles aériennes (I5) sont le travail du M2.10.

**Pas de simulation** (`tools/bot/perf.mjs`, machine au repos) : sur 80 jours d'Atlantique,
pas le plus long entre 4 et 19 ms selon les passes (six parties), aucun pas au-delà de 20 ms,
sauf un pas isolé de 71 ms dans une passe, qui ne se reproduit pas sur la même partie rejouée
(11 puis 16 ms) : bruit de la machine (ramasse-miettes), pas un calcul. Rejouée deux fois
dans le même processus, la même partie a un pas le plus long de 16 ms puis de 5 ms.

**Images par seconde à ×14 400** (`tools/smoke/fps.mjs`, Atlantique au jour 40) : 59,3 sans
fiche et 59,8 avec la fiche d'une escorte ; une image de 117 ms sur 475, aucune autre au-delà
de 50 ms.

### Porte du M2.8

- **30 à 60 arrêts par partie** : avec les réglages par défaut (Standard, arrêt sur
  décision), 42 à 59 sur 70 parties, moyenne 51 (avant : 50 à 147, moyenne 105). En
  Réaliste, 47 à 61 sur 30 parties : une partie dépasse la cible d'un arrêt (Rester,
  graine 7 : 38 relèves avec décision et 23 premières attaques de nuit). Chaque arrêt porte
  une décision possible : convoi à portée d'un groupe libre (une fois par convoi), repère sur
  la route (une fois par routage), première attaque de la nuit sur un convoi. Je ne force pas
  cette partie sous 60 : il faudrait retirer un arrêt que le document demande.
- **Aucune conduite sûre de gagner** : dans l'Atlantique, aucune conduite n'est à 10 sur 10 ;
  Rester et Chasser sont à 9 sur 10 en Standard, à 5 et 2 sur 10 en Réaliste. Avant le lot,
  Chasser gagnait 10 fois sur 10.
- **Chaque pas sous 20 ms** : oui, mesuré machine au repos (voir ci-dessus).
- Tests : 300, lint et construction verts ; 10 000 ordres au hasard par scénario sans
  problème ; test de fumée vert. Déterminisme : mêmes graine et ordres, même monde,
  sauvegarde et reprise comprises (`tests/roundtrip.test.js`, et le test d'ordres au hasard,
  qui sauvegarde et reprend en cours de route).

La porte est franchie, avec la réserve dite sur une partie en Réaliste.

**Écarts au document, pour le compte rendu** : ombre de la nuit en image (pas en contour) ;
décision « repère sur la route » demandée une fois par routage ; règles de chasse (bateau
endommagé lâché, recherche de 45 minutes qui retrouve une fois sur trois, chances par passe
abaissées, groupe en Rester qui ne part que sur ce qu'il peut atteindre) ; remplacement des
U-Boote coulés après 21 jours (ajout) ; seuil de l'Atlantique à 7,5 % au lieu de 8 % ; un
signal d'un groupe donne un point sûr ; pas d'entrée dans un groupe de soutien en haute mer.

## M2.9 · Menu principal, sauvegardes et réglages

Branche `m2.9`, depuis `m2.8`. Écrit en partie pendant les mesures du M2.8 (dans une copie de
travail à part), puis reposé sur le M2.8 terminé.

### 18 novembre, 21 h 40 à 23 h 35 — réglages dans la partie, formats de sauvegarde, données

- **Code 4, N9 — les réglages appartiennent à la partie** (`src/sim/gameSettings.js`). Le
  monde reçoit sa copie des réglages qui changent les règles (détection, fausses alertes,
  aide à l'interception, carburant, ordres, logistique, fatigue, report de campagne, B-Dienst,
  communications en mer, arrêt aux relèves, questions, aide au rassemblement) ; le reste (son,
  ombre de la nuit, place de la fiche, vitesses des alertes) est de l'affichage et reste au
  joueur. Un réglage ne change plus que par un ordre (`setGameSetting`, `applyPreset`), noté au
  journal ; la page Réglages ouverte en jeu donne ces ordres au lieu d'écrire dans les
  réglages. La partie retient le préréglage de son début (`presetStart`). Choix : le report de
  campagne est fixé au départ (on ne défait pas à mi-partie ce que la campagne a reporté), et
  le nom du préréglage n'en tient pas compte, pour qu'une partie passée de Réaliste à
  Standard s'appelle Standard.
- **Code 7 — noms trompeurs.** `thirty` devient `min30` et `available` devient `min5`
  partout (règles, textes, simulation, tests). Les sauvegardes sont migrées.
- **I7, Code 8 — formats** (`src/save/migrate.js`). Le format passe à 2 ; une migration par
  version (de 1 à 2 : les états d'alerte renommés, où qu'une escadrille en garde un) ; une
  validation avant de toucher au monde (ce n'est pas une partie, version plus récente,
  fichier abîmé avec le champ en cause, scénario inconnu, autre scénario), chaque refus avec
  sa phrase dans `fr.json`. Les trois parties 2.6.1 des tests se chargent.
- **I7 — emplacements** (`src/save/store.js`, `pack.js`). La partie en cours est écrite telle
  quelle, d'un coup, pour que fermer la page ne perde rien ; les sauvegardes automatiques
  (cinq gardées) et manuelles sont compressées par le navigateur (`CompressionStream`, sans
  bibliothèque). Un stockage plein est dit, après un essai en libérant la plus vieille
  sauvegarde automatique. La partie laissée par la version 2.8 devient la partie en cours.
- **N8, Code 6 — données.** `data/campaign.json` (chaîne, entraînement, vues, cartes de
  scénario avec durée estimée, couches et outils par défaut), bloc `map` et `seaRhythm` dans
  chaque scénario (zone, vue de départ, couches, outils), `data/tutorial.json` (étapes du
  tutoriel et conditions de passage, interprétées par `src/ui/tutorial.js`).

### 18 novembre, 23 h 35 à 19 novembre, 1 h 00 — menu, vie d'une partie, découpage, fabrique

- **N3, C1, C3, C16 — menu principal** (`src/ui/menu.js`) : page pleine, hors de la carte, avec
  les entrées du document ; cartes de scénario (dates, enjeu, durée estimée) ; ☰ en jeu ;
  confirmations (remplacer une partie en cours ; recommencer dès dix minutes de jeu réel), la
  partie remplacée étant gardée parmi les sauvegardes automatiques ; écran de fin avec
  Rejouer, Scénario suivant et Menu principal, et l'histoire du préréglage. Ajout : « Exporter »
  dans le menu ☰ (l'export n'avait plus de place ailleurs).
- **Préréglage « choisi au lancement »** : un choix à trois boutons sur les pages Campagne et
  Scénarios, avec une phrase qui dit ce que le préréglage change. Il règle les réglages des
  prochaines parties ; une partie en cours garde les siens.
- **Vie d'une partie** (`src/ui/game.js`) : nouvelle partie, reprise, sauvegarde en cours tous
  les quarts d'heure de jeu, automatique quand le jour de jeu tourne (toutes les deux heures de
  jeu si le scénario dure moins de 36 heures), manuelle, import et export.
- **`main.js` découpé** : 1 079 lignes deviennent 230 (données, montage, barre du haut) ;
  `elements.js`, `loop.js`, `sheet.js`, `gameEvents.js`, et `panelActions.js` où le grand
  aiguillage des boutons devient une table d'actions. Vérifié contre l'ancien code : les
  mêmes 80 actions de clic et 8 de champ. Sept entrées ne répondaient plus à aucun bouton
  (héritées de versions anciennes) : retirées, avec deux ordres d'interface morts.
- **Code 1 — fabrique d'entités** étendue aux escadrilles, aux groupes d'escorte, aux U-Boote
  et aux raids : chaque sous-système déclare ce qu'il garde (alerte et tableau de service,
  formation, règles d'engagement, chasses, route d'un U-Boot…). Les listes de valeurs par
  défaut écrites à la main dans la sauvegarde ont disparu. Cinq parties du joueur automatique
  rejouées donnent exactement les mêmes résultats qu'au M2.8.
- **Aide** : un onglet « Parties et réglages ».

**Mesures faites en chemin** (Chrome sans écran, Atlantique joué jusqu'au jour 79) : une
sauvegarde pèse 610 000 caractères en fin de partie (536 lignes de journal, 474 rapports de
quart) ; la partie en cours et cinq sauvegardes automatiques occupent 860 000 caractères, loin
de la limite du navigateur (environ 5 millions) ; écrire la partie en cours prend 14 ms.

**Choix à signaler** : les durées estimées des cartes de scénario sont des estimations de ma
part, à corriger avec le chrono de jeu ; le scénario d'entraînement suit le calendrier de
Kanalkampf, donc une sauvegarde automatique par jour de jeu. (Le journal gardé dans une
sauvegarde était d'abord limité à 2 000 lignes : la relecture a montré qu'une semaine
d'Adlertag peut en écrire 2 400. La limite n'est plus qu'un garde-fou, à 20 000 lignes.)

### Mesure après le M2.9 (19 novembre, 3 h 40)

Le M2.9 ne change pas la simulation : la mesure doit donner les mêmes parties qu'après le M2.8.
Les 340 parties (10 graines par conduite, campagne comprise) rejouées au commit `4d9c9b1` sont
**identiques une à une** à celles du M2.8 : même issue, mêmes pertes, mêmes arrêts, mêmes
objectifs (`tools/bot/out/m2.9.jsonl` comparé à `m2.8.jsonl`, hors durées de calcul). Les
tableaux du M2.8 valent donc pour le M2.9 : arrêts de l'Atlantique 42 à 59 en Standard, 47 à
61 en Réaliste ; aucune conduite de l'Atlantique à 10 sur 10.

Autres mesures : 59,9 images par seconde à ×14 400 sans image au-delà de 50 ms ; pas de
simulation le plus long 4,5 à 8,7 ms (mesuré seul) ; 10 000 ordres au hasard par scénario sans
problème, réglages de partie compris.

### 19 novembre, 3 h 45 à 5 h 50 — relecture du M2.9 par un agent neuf, et ses suites

Un agent qui n'avait pas vu le travail a relu le lot contre les critères du document, avec ses
propres scripts (interrompu une fois par une limite de débit, puis repris). Verdict : la porte
tient (chaque scénario se lance, se sauvegarde et se recharge depuis le menu, à l'identique) ;
**5 défauts majeurs, 8 mineurs**, aucun bloquant. Tous sont traités, chacun avec son test
(`tests/review29.test.js`, `tests/store.test.js`, essai de fumée) :

1. **Les touches du jeu restaient actives sous le menu principal** (le menu n'est plus une
   boîte de dialogue : la garde ne jouait plus). La touche 3 faisait tourner la partie
   derrière le menu, jusqu'à sa fin ; Entrée répondait à une question sans la montrer.
   Corrigé : sous le menu, les touches du jeu ne font rien et la boucle n'avance pas.
2. **La leçon lancée depuis le menu n'était pas en pause** à sa première étape, qui dit « le
   temps est arrêté ». Corrigé. Suite : une partie lancée dont l'horloge est encore à sa
   première minute compte comme commencée après une minute passée dessus (des ordres
   préparés en pause sont une partie à garder).
3. **Stockage plein : rien au menu, et une partie remplacée perdue malgré la promesse.**
   Corrigé : l'échec s'affiche au menu principal tant qu'aucun enregistrement n'a réussi ;
   quand la partie à remplacer n'a pas pu être gardée, le jeu le dit et redemande, avec
   l'export à portée de main (« Remplacer quand même »).
4. **La partie remplacée était évincée par les sauvegardes automatiques de la suivante.**
   « Les cinq dernières » sont maintenant celles de la partie en cours ; chaque partie d'avant
   garde sa plus récente (cinq parties au plus). C'est une lecture du document, à confirmer.
5. **Un fichier au journal abîmé remplaçait la partie en cours en disant le contraire.**
   Corrigé : le journal et les notes d'un fichier sont nettoyés à la lecture, et rien de la
   page ne change avant que la sauvegarde soit entièrement remise en place.
6. **Validation trop courte** : des fichiers abîmés se chargeaient puis arrêtaient le jeu.
   Deux contrôles de plus avant de charger : chaque partie de la sauvegarde doit être du genre
   que le jeu y garde (liste, table, nombre, fiche à entrées fixes), par comparaison avec un
   monde neuf du même scénario ; puis la sauvegarde est essayée dix minutes de jeu sur un monde
   à part. Sur 150 variantes abîmées par scénario (chaque partie retirée, vidée ou changée de
   genre) : 141 à 145 refusées avec une phrase en français, les autres sont des parties saines
   ou sans effet. Contre-épreuve : 3 424 instantanés de parties entières du joueur
   automatique, passés par JSON, tous acceptés.
7. **Un enregistrement raté sur stockage plein effaçait une sauvegarde automatique** : celle
   qui fait de la place est remise si la place ne suffit pas.
8. **L'import demandait « Remplacer ? » avant de vérifier le fichier**, et faisait une
   sauvegarde automatique pour rien. Le fichier est vérifié d'abord.
9. **Préréglage nommé de deux façons** quand seul le report de campagne s'écarte du
   préréglage : la partie est nommée dès le départ par la règle du jeu (le report, fixé au
   lancement, n'entre pas dans le nom).
10. **Outils et vues d'un scénario** : seuls les boutons étaient masqués. Les touches, les
    liens des fiches et les pages demandent maintenant au même endroit (`src/ui/offered.js`).
    Reste : la `zone` déclarée ne sert que de repli pour la vue de départ.
11. **Journal limité à 2 000 lignes** : voir ci-dessus.
12. **Deux pages du jeu sur le même stockage s'écrasaient ; un index illisible effaçait tout.**
    L'index est relu avant chaque écriture, les numéros ne sont plus redonnés, et un index
    perdu est refait à partir des sauvegardes, qui portent chacune leur ligne.
13. **Textes de l'ancien menu** corrigés ; six clés sans usage retirées.

Notes de la relecture, traitées aussi : une leçon n'est plus enregistrée (elle revenait sans
son instructeur) ; phrase pour un enregistrement impossible après une erreur ; une partie
terminée importée montre son écran de fin ; une partie reprise depuis le navigateur attend le
joueur en pause ; l'aide ouverte depuis le menu sans partie en cours n'a plus d'onglet « Ce
scénario » ; code mort retiré ; l'essai de fumée vérifie « Scénario suivant » sans condition.

**Laissé tel quel, à trancher par Florian** : « Ombre de la nuit » et « Vitesse des alertes »
restent des réglages du joueur (affichage), pas de la partie ; « Recommencer », « Rejouer » et
« Scénario suivant » partent des réglages choisis au lancement, pas de ceux que la partie avait
à la fin.

**Un test existant adapté, sans l'affaiblir** : `tests/campaign.test.js` imitait une partie de
la version 2.6.1 en retirant deux valeurs d'un instantané au format courant. Un tel instantané
est maintenant refusé (il lui manque des parties) ; l'imitation porte donc le numéro de format
de ce qu'elle imite (format 1). Ce qu'elle vérifie n'a pas changé.

**Règle pour la suite** : ajouter une partie au monde, ou une entrée à l'une de ses fiches
(compteurs, réserves…), demande un nouveau numéro de format et sa migration ; sinon les
sauvegardes du format en cours seraient refusées. `tests/oldsaves.test.js` charge une
sauvegarde de chaque format pour le rappeler.

### Porte du M2.9

Critère du document : « chaque scénario se lance, se sauvegarde et se recharge depuis le menu ».

- **Tenu.** L'essai de fumée lance les cinq scénarios depuis le menu, les sauvegarde par ☰,
  revient au menu, laisse la partie avancer, recharge la sauvegarde : l'empreinte du monde
  rechargé (scénario, horloge, dés, unités, préréglage) est celle du monde sauvegardé. Le
  relecteur l'a vérifié de son côté dans les cinq scénarios, parties rejouées ensuite à
  l'identique, et avec des parties faites par la vraie version 2.8 et par la 2.6.1.
- **À chaque lot** : branche `m2.9` et demande de fusion ; 350 tests, lint, construction de
  `dist/index.html` ; déterminisme (mêmes graine et ordres, même monde, sauvegarde, reprise et
  changement de préréglage compris) ; joueur automatique avant et après sur 10 graines par
  conduite : 340 parties identiques ; 10 000 ordres au hasard par scénario ; essai de fumée
  complet (149 vérifications, développement et fichier unique ouvert depuis le disque) ;
  README à jour.
- **Ce qui reste ouvert dans ce lot** : la `zone` d'un scénario ne pilote rien d'autre que le
  repli de la vue de départ ; la validation ne descend pas dans chaque champ de chaque unité
  (l'essai de dix minutes et le garde-fou de la boucle prennent le relais) ; les navigateurs
  autres que Chrome n'ont pas été essayés (stockage plein réel, absence de compression).

## M2.10 · Interface, équilibre et tutoriel

Branche `m2.10`, partie de `m2.9`. Porte du document : « les trois règles d'équilibre tenues
partout ; tutoriel joué de bout en bout ».

### 19 novembre, 1 h 00 à 2 h 10 — fatigue (I6) et équilibre (I5)

- **I6 — la fatigue pèse.** Avant : l'Alerte 5 min reposait (−2 par heure) et le Disponible
  30 min plus encore (−5) ; il suffisait de ne toucher à rien. Maintenant, par heure : Repos −8
  et Cockpit +3 (inchangés), Disponible 30 min −1, Alerte 5 min +0,1 (seuils inchangés :
  fatiguée à 60, épuisée à 85). Premier essai avec le vol tel qu'il était (7 par heure de vol,
  2,5 par passe de combat, 2 par décollage) : à Adlertag, la conduite simple, qui ne met
  jamais au repos, épuisait ses escadrilles dès le troisième jour. Le vol fatigue donc moins
  (4, 1,5 et 1). Mesuré sur Adlertag (sonde du joueur automatique, graines 1 à 4) : une semaine
  à cinq minutes finit à 75 à 80 de fatigue en moyenne, avec 4 à 7 escadrilles fatiguées et
  2 à 4 épuisées ; la même semaine avec la relève de nuit finit à 15 à 19, sans une
  escadrille fatiguée. C'est un écart au document, qui ne parlait que des états au sol : sans
  lui la cible (« fatiguées, et la relève devient utile ») devenait « épuisées ».
- **Bouton Effectifs masqué sans fatigue**, ainsi que le lien vers les plans dans les fiches.
- **I5 — Kanalkampf.** Avant : gagné 10 fois sur 10 sans faire décoller un seul chasseur.
  Seuils des convois relevés (HX 60 → 80 %, convoi côtier CW 50 → 75 %), objectif d'avions
  abattus ajouté (30), chasse à garder relevée (60 → 90 %) : il faut engager assez pour
  protéger et faire payer, sans user sa chasse.
- **I5 — Adlertag.** Avant : bases et radars tenaient sans un ordre, et l'on gagnait 10 fois
  sur 10 sans commander un seul train. Les objectifs « bases » et « radars » regardaient
  l'état au dernier soir, quand tout est réparé : ils comptent maintenant les **heures hors
  service cumulées sur la semaine** (aérodromes : 10 heures au plus ; radars : 36 heures au
  plus), suivies minute par minute et affichées. Les bases des escadrilles commencent avec
  40 % du carburant qu'elles avaient : sans trains, sept parties sur dix finissent en panne
  sèche. Chasse à garder : 50 → 45 % (la fatigue coûte des avions).
- **I5 — 15 septembre.** Le document demandait de garder le réglage. Mesuré après le nouveau
  calcul du jour (M2.8), il ne tenait plus les règles : jouer simple gagnait 5 fois sur 10 en
  Standard, et la conduite soignée 1 fois sur 10 en Réaliste. Deux changements : le nombre
  d'avions à abattre passe de 40 à 32, et la conduite « soignée » du joueur automatique masse
  ses escadrilles ce jour-là (six par raid, poursuite permise), comme le fait la conduite
  « masse » : c'est ce qu'un joueur soigné fait le 15 septembre.
- **Outils.** `tools/bot` : une conduite peut différer selon la bataille (`byScenario`) ; une
  sonde appelée chaque minute de jeu (`probe`) pour regarder une partie de près.

### 19 novembre, 2 h 10 à 3 h 20 — interface (C6, C7, C8, C9)

- **C7 — barre du haut.** Dix outils en pictogrammes, avec leur nom et leur touche en bulle
  (« Règle (R) ») et un mot dessous quand la place le permet ; un seul bouton « Vue » qui
  liste les vues du scénario ; le Journal (J) et l'aide (?) ont leur touche. Mesuré : une
  ligne de 51 px de haut à 1 024 px de large, le 15 septembre comme dans l'Atlantique (17
  boutons visibles, temps compris).
- **C6 — alertes.** Une alerte qui demande un ordre porte « À décider » et reste jusqu'à
  l'ordre ou la fermeture ; une information s'efface en trente secondes. Une alerte chassée
  par une plus urgente revient ensuite si elle attend toujours son ordre. Au-delà de quatre
  en attente, la plus ancienne va au journal comme « non lue » : le bouton Journal les compte
  et ouvre le journal sur elles. Ajout : une alerte à décider se ferme d'elle-même quand son
  ordre est donné (un chasseur envoyé contre le raid, un train de carburant parti, un groupe
  en route vers le convoi…).
- **C8 — aides des fiches.** Réglage « Aides des fiches » : affichées (par défaut) ou
  repliées ; repliées, chaque section garde un « ? » qui montre la sienne ; les
  avertissements restent toujours visibles.
- **C9 — piles et onglets.** Les plaques qui se recouvrent deviennent une marque avec leur
  nombre ; un clic ouvre la pile en onglets verticaux sur le bord gauche de la fiche ;
  l'onglet actif est mis en avant sur la carte, les autres s'estompent ; un glisser depuis une
  pile qui n'est pas ouverte ne fait rien ; lâché sur plusieurs cibles superposées, un
  glisser demande laquelle. Les piles sont calculées à partir des marques de l'image
  précédente (`src/ui/stacks.js`) : rien dans la simulation.

### 19 novembre, 3 h 20 à 6 h 10 — tutoriel en quatre leçons (I10), suites du M2.9

- **Quatre leçons**, chacune sur un petit scénario écrit comme une bataille existante avec
  des changements (`"base"`, `src/core/scenarios.js`) et avec ses propres réglages :
  intercepter (un raid que l'instructeur laisse passer en faisant décoller quand il franchit
  la côte, puis le bilan avec les heures : « vu à 12:02, ordre à 12:18, bombes à 12:23 » ;
  puis un raid de douze Do 17 sans escorte, lâché deux minutes après le briefing) ;
  ravitailler (une base presque à sec, un train, un stock minimum) ; escorter (la relève de
  8 heures, « Envoyer » dans le rapport de quart, les consignes et le grenadage) ; états
  d'alerte et fatigue (une escadrille fatiguée mise au repos, une reposée rappelée, la page
  Effectifs, une nuit). Les étapes, leurs conditions et les ordres de l'instructeur sont des
  données (`data/tutorial.json`) ; les textes sont dans `fr.json`.
- **Défauts trouvés en jouant dans Chrome** : le raid de l'élève apparaissait sous la fiche
  (une étape qui demande une vue attend maintenant que la fiche soit dessinée, et se cale
  sur la largeur libre) ; la confirmation « Au repos » attendait jusqu'à un quart de seconde
  (la fiche se redessine dès la fin de l'appui) ; le bandeau affichait la clé du titre d'une
  leçon.
- **Durée des leçons** (essai de fumée : mots à lire, attentes du jeu, ordres à donner) :
  5,3 · 3,7 · 3,5 · 3,3 minutes à une première lecture attentive (120 mots par minute) ;
  3,6 · 2,5 · 2,4 · 2,0 minutes rejouées en lisant vite. Le document demande trois à cinq
  minutes : tenu à la première lecture, la leçon 1 un peu au-dessus.
- **Fusion des suites de la relecture du M2.9** (voir plus haut) et ce qu'elles changent
  pour les leçons : une leçon ne s'enregistre jamais et ne remplace rien ; la partie en
  cours est écrite avant la leçon, sans question, et « Continuer » la ramène ensuite ; une
  leçon finie ou quittée rend la liste des leçons ; « Sauvegarder » n'y est pas proposé.

### Mesure après le M2.10 (19 novembre, 5 h 15 à 6 h 05)

Joueur automatique, 10 graines par conduite, 340 parties au commit `efc6bb7`
(`tools/bot/out/m2.10.jsonl`) ; « avant » est la mesure du M2.9, identique à celle du M2.8.

| Scénario | Préréglage | Conduite | Avant | Après | Objectifs manqués après |
| --- | --- | --- | --- | --- | --- |
| Kanalkampf | Standard | rien | 0 sur 10 | 0 sur 10 | convois, avions abattus |
| Kanalkampf | Standard | simple | 10 sur 10 | 8 sur 10 | avions abattus 1 fois, un convoi 1 fois |
| Kanalkampf | Standard | sans chasse | 10 sur 10 | 0 sur 10 | avions abattus 10 fois, convois 7 fois |
| Kanalkampf | Réaliste | simple | 10 sur 10 | 8 sur 10 | un convoi 1 fois, avions abattus 1 fois |
| Kanalkampf | Réaliste | soigné | 10 sur 10 | 9 sur 10 | un convoi 1 fois |
| Adlertag | Standard | rien | 0 sur 10 | 0 sur 10 | heures hors service, avions abattus, convoi |
| Adlertag | Standard | simple | 9 sur 10 | 8 sur 10 | chasse 2 fois |
| Adlertag | Standard | sans ravitaillement | 10 sur 10 | 0 sur 10 | panne sèche 7 fois, avions abattus 7 fois |
| Adlertag | Standard | 1 par raid | 5 sur 10 | 1 sur 10 | avions abattus 9 fois, heures hors service 5 fois |
| Adlertag | Standard | 2 par raid | 9 sur 10 | 7 sur 10 | heures hors service 2 fois |
| Adlertag | Standard | 4 par raid | 2 sur 10 | 1 sur 10 | chasse 9 fois |
| Adlertag | Réaliste | simple | 10 sur 10 | 9 sur 10 | chasse 1 fois |
| Adlertag | Réaliste | soigné | 10 sur 10 | 10 sur 10 | — |
| 15 septembre | Standard | rien | 0 sur 10 | 0 sur 10 | avions abattus, docks |
| 15 septembre | Standard | simple | 5 sur 10 | 8 sur 10 | avions abattus 2 fois |
| 15 septembre | Standard | 2 par raid | 4 sur 10 | 8 sur 10 | avions abattus 1 fois, docks 1 fois |
| 15 septembre | Standard | 4 par raid | 10 sur 10 | 10 sur 10 | — |
| 15 septembre | Réaliste | simple | 7 sur 10 | 8 sur 10 | avions abattus 2 fois |
| 15 septembre | Réaliste | soigné | 1 sur 10 | 9 sur 10 | chasse 1 fois |
| 15 septembre | Réaliste | en masse | 9 sur 10 | 9 sur 10 | chasse 1 fois |
| Campagne | Standard | simple | 0 sur 10 | 5 sur 10 | 7 chaînes sur 10 arrivent au 15 septembre |
| Campagne | Réaliste | simple | 0 sur 10 | 0 sur 10 | avions abattus le 15 septembre, 7 fois |
| Campagne | Réaliste | soigné | 0 sur 10 | 8 sur 10 | 9 chaînes sur 10 arrivent au 15 septembre |
| Campagne | Réaliste | simple, puis en masse le 15 | 4 sur 10 | 6 sur 10 | |

**Atlantique** : les 100 parties sont identiques une à une à celles du M2.8 (le lot n'y
change rien). Rien 0 sur 10 ; Rester 9 sur 10 ; Chasser 9 sur 10 ; Réaliste : Rester 5,
Chasser 2, soigné 7 sur 10 ; arrêts 42 à 59 en Standard, 47 à 61 en Réaliste.

Lecture des trois règles :

1. **Ne rien faire perd nettement** : 0 sur 10 dans les quatre scénarios.
2. **Jouer simple gagne environ quatre fois sur cinq en Standard** : Kanalkampf 8, Adlertag
   8, 15 septembre 8, Atlantique 9 sur 10.
3. **Jouer soigné gagne en Réaliste** : Kanalkampf 9, Adlertag 10, 15 septembre 9,
   Atlantique 7 sur 10 ; la campagne en Réaliste jouée avec soin, 8 sur 10.

Ce que la mesure dit aussi : à Adlertag, s'engager trop (quatre escadrilles par raid) perd la
chasse neuf fois sur dix, et trop peu (une par raid) laisse bombarder : le dilemme est là.
En Réaliste, le joueur automatique gagne aussi en jouant simple (8 à 9 sur 10) : ce qui rend
le Réaliste dur pour un joueur (plots en retard, pas d'aide, ordres au cap) ne le gêne pas.
La campagne en Réaliste jouée simplement de bout en bout n'est jamais gagnée : le 15
septembre demande alors d'engager en masse.

### 19 novembre, 6 h 10 à 9 h 30 — relecture du M2.10 par un agent neuf

Un agent qui n'avait pas vu le travail a relu le lot au commit `6154cd9`, contre les critères
du document (C6 à C9, I5, I6, I10, « à chaque lot », porte du lot). Arrêté une fois par la
limite d'usage, puis repris. Il a joué les leçons, les écrans à 1 024 px, les piles, les
alertes, rechargé cinq sauvegardes réelles de la 2.9.0, et rejoué la mesure sur des graines
neuves.

**Ce qu'il confirme** : lint propre ; 376 tests verts ; `dist/index.html` identique à la
construction ; essais de fumée par partie (tutoriel 42 vérifications, interface 29, menus 90,
quarts 19, scénarios 12, page construite 8) ; le fichier de la mesure, par 13 parties rejouées ;
C8 (aides des fiches) ; C9 pour les repères, les onglets, le glisser et le tactile ; les taux
et la cible d'I6 ; le déterminisme ; cinq sauvegardes 2.9.0 qui se chargent et se rejouent.

**Ce qu'il trouve** : aucun point bloquant, neuf points majeurs, une série de mineurs.

| N° | Constat | Suite |
| --- | --- | --- |
| 1 | Après une leçon, une nouvelle partie lancée du menu détruisait sans question la partie gardée | Corrigé (`d360975`) : la question est posée pour la partie gardée, et une copie de sécurité est prise |
| 2 | L'essai de fumée complet était rouge (« plaques empilées », écrit avant les piles) alors que la CI le lance en entier | Corrigé : l'étape est récrite sur les piles ; l'essai complet est rejoué avant la livraison |
| 3 | « Plus de carburant » se fermait aussitôt (tenue pour répondue dès 1 t en stock) | Corrigé : répondue par un train de carburant en route, ou quand plus aucune escadrille n'attend |
| 4 | Une décision vieille de six heures de jeu disparaissait sans être comptée | Corrigé : une décision ne vieillit pas ; une information jamais vue passe au journal, non lue |
| 5 | L'équilibre ne tient que sur les graines 1 à 10 (graines neuves : Kanalkampf Standard simple 12 sur 20, Adlertag 14 sur 20, 15 septembre Réaliste soigné 5 sur 10) | Mesure reprise sur 30 graines, puis 20 de plus ; deux seuils retouchés (voir plus bas) |
| 6 | « 15 septembre : garder le réglage actuel » non tenu (40 → 32 avions) ; « soigné » y était devenu « en masse » sans le dire | Écart gardé, expliqué et posé comme question ; conduites nommées pour ce qu'elles font (`soigne` = en masse ce jour-là, `prudent` à côté) |
| 7 | À 1 024 px, fiche ouverte : bandeau d'alerte de 260 × 324 px sur la carte ; la boîte de leçon passait de 88 px sous la fiche | Corrigé : bandeau 260 × 98 px, boîte de leçon à côté de la fiche |
| 8 | Leçon 1 : faire décoller le 111 Sqn pendant la démonstration sautait les étapes « décollez » et « altitude » | Corrigé : pendant une démonstration l'instructeur a la main ; les conditions se comptent depuis l'étape |
| 9 | Sous 1 250 px les mots sous les pictogrammes étaient cachés, alors qu'ils tiennent à 1 024 px | Corrigé : mots gardés ; « Non enregistré » réduit à son signe ⚠ à ces largeurs |
| 10 | L'alerte d'un raid ne se fermait que si un trait finissait sur le raid ; elle revenait pour un raid qui avait bombardé | Corrigé : un ordre de décoller donné pendant l'alerte y répond ; un raid qui a bombardé n'a plus rien à décider |
| 11 | « Voir » fermait une décision | Corrigé : « Voir » montre l'endroit, la décision reste |
| 12 | Au-delà de quatre alertes, ce n'était pas la plus ancienne qui partait au journal | Corrigé : numéro d'ordre des alertes ; les plus anciennes non lues partent |
| 13 | « Effectifs » offert là où il n'y a aucune escadrille de chasse (Atlantique, leçon 3) | Corrigé |
| 14 | Convoi empilé : plus une cible de tracé ; tout convoi escorté réduit à « 2 » et deux noms ; glisser depuis une pile fermée sans réponse | Corrigé : les unités d'une pile restent des cibles ; un convoi avec son escorte garde son repère et sa plaque ; la carte dit pourquoi rien ne se trace |
| 15 | Fins de leçon : « Exporter » offert ; scénario de leçon épuisé = « Objectifs non atteints », puis « Rejouer » sans instructeur ; textes à côté de l'écran ; leçon 1 à 5,3 minutes | Corrigé (détail plus bas) |
| 16 | Textes : restes du tutoriel unique, « menu du haut », touches J et ? absentes de la liste, aide muette sur les piles et les décisions | Corrigé |
| 17 | `tests/crews.test.js` : borne calculée depuis la règle qu'elle vérifie | Corrigé : borne chiffrée, des deux côtés |
| 18 | `outS` et `held` ajoutés sans nouveau format de sauvegarde | Vérifié sans danger (lus avec une valeur par défaut) ; note dans `src/save/migrate.js` |
| 19 | La page écrivait `world.ended` ; « Vue » ne se fermait pas avec Échap ; une big wing qui se rassemble faisait une pile d'elle-même | Corrigé |

### 19 novembre, 9 h 40 à 12 h 30 — suites de la relecture

Commits `d360975` et `6d0c04d`, puis ceux qui suivent. Par thème :

- **Alertes (C6).** Une alerte « à décider » ne vieillit plus ; une information que personne
  n'a vue passe au journal comme non lue au lieu de disparaître. Chaque alerte porte un
  numéro d'ordre : au-delà de quatre en attente, ce sont les plus anciennes non lues qui
  partent au journal, et une alerte chassée du bandeau avant d'avoir pu être lue (moins
  d'une seconde et demie) reprend sa place dans la file. « Voir » ne ferme que les
  informations. L'alerte d'un raid se ferme quand une escadrille qui était au sol reçoit
  l'ordre de décoller (bouton, touche ou tracé, avec ou sans trait jusqu'au raid), et quand le
  raid a bombardé. Les alertes de stock se tiennent pour répondues par un train en route.
  Quatre tests de plus dans `tests/alertqueue.test.js` ; le test du carburant, qui décrivait
  le défaut, est récrit sur la condition que la simulation applique.
- **Leçons (I10).** Les étapes de démonstration portent `handsOff` dans `data/tutorial.json` :
  la boîte dit « Regardez… », et un ordre demandé par une touche, un bouton de fiche ou un
  tracé ne part pas ; la boîte dit pourquoi pendant quelques secondes. Les autres étapes
  d'attente disent « Le temps passe… », et « À vous… » ne s'affiche plus que quand c'est
  vrai. Les conditions `airborne` (en montée ou en vol, pas sur le retour) et `seenSince`
  (vu depuis le début de l'étape) remplacent ce qui laissait sauter deux étapes. Un scénario
  de leçon qui s'achève avant la leçon ouvre « La leçon s'arrête ici » : pas de verdict, rien
  d'enregistré dans la campagne, **et la partie gardée dans le navigateur n'est plus
  retirée** (le même défaut que le n° 1, par un autre chemin) ; « Rejouer la leçon » la
  redonne avec son instructeur. Textes : les minutes du bilan se comptent sur les heures
  affichées (« 12:18 … 12:23 » fait cinq minutes) ; « Envoyer EG 1 (Liverpool) » comme sur
  le bouton ; la fatigue s'affiche maintenant sous le nom de l'escadrille dès qu'elle est
  fatiguée, ce que la leçon 4 montre du doigt ; le convoi d'une leçon sans dollars n'est plus
  « payé 0 million ». Leçon 1 raccourcie de 435 à 395 mots.
- **Piles (C9).** Un convoi et son escorte gardent le repère du convoi (navires, cap) et sa
  plaque (navires, nœuds), avec le nombre et, dessous, « avec EG 2 » : c'est la vue la plus
  courante de la mer, elle ne doit rien perdre. Les unités d'une pile restent des cibles
  pour le tracé d'un autre groupe. Un glisser depuis une pile fermée ne trace toujours rien et
  ne prend toujours rien en main (c'est la règle du document), mais la carte le dit pendant
  quatre secondes : « 2 unités ici : cliquez pour choisir laquelle, puis tracez sa route ».
  Les escadrilles d'une big wing en rassemblement comptent pour une unité : seule, la wing
  n'est plus une pile ; avec une autre escadrille, elle a un onglet.
- **Largeur 1 024 px.** Le bandeau d'alerte se replie sur ses boutons (260 × 98 px au lieu
  de 260 × 324) ; la boîte de leçon se loge à côté de la fiche ; les mots restent sous les
  pictogrammes ; « Non enregistré » se réduit à ⚠ (sa bulle et le journal disent le reste),
  faute de quoi la barre passait sur deux lignes à Adlertag.
- **Divers.** « Effectifs » demande une escadrille de chasse. « Vue » se ferme avec Échap. La
  page n'écrit plus dans le monde de la simulation pour dire qu'une leçon est finie
  (`app.dropped`). Aide : piles, décisions, compteur du bouton Journal, touches J et ? ; plus
  de « tutoriel guidé » ni de « menu du haut ».

**Deux vérifications de l'essai de fumée ont changé de forme, pas d'exigence.** « Un glisser
depuis une pile fermée ne donne aucun ordre » reste telle quelle, et une vérification
s'ajoute (la carte le dit). La durée d'une leçon se juge maintenant à cinq minutes au plus
(cinq et demie avant) : 4,9 · 3,7 · 3,6 · 3,3 minutes à une première lecture.

**Un test a changé de borne parce que la règle a changé.** « Une heure de vol fatigue » :
plus de 5 points avant le lot (7 par heure de vol et 2 par décollage), entre 4,5 et 5,5
points maintenant (4 et 1). C'est le déplacement voulu par I6 : la fatigue vient moins des
sorties et davantage des heures passées en alerte. La borne est de nouveau un chiffre, et
elle encadre des deux côtés.

### 19 novembre, 10 h 45 à 11 h 40 — l'équilibre repris sur 30 graines, vérifié sur 20 autres

Le relecteur avait raison sur le fond : les seuils du lot avaient été choisis et mesurés sur
les mêmes dix graines. Pour sortir de là sans rejouer à chaque essai, un outil joue les
batailles une fois et garde ce que mesure chaque objectif, quelle que soit sa barre ; les
mêmes parties se rejugent ensuite sous d'autres seuils en une seconde
(`tools/bot/thresholds.mjs`, versé au dépôt ; les chiffres ci-dessous viennent de sa première
version, hors dépôt, sur les mêmes parties). Sous les seuils du jeu, ses verdicts sont ceux
du jeu pour les 910 parties, sans exception.

Collecte : 630 parties sur les graines 1 à 30 (toutes les lignes des trois batailles), puis
280 sur les graines 31 à 50, jamais vues pendant le réglage (les lignes qui portent les trois
règles). Victoires, sur le nombre de parties :

| Bataille, seuil | Conduite | Graines 1 à 30 | Graines 31 à 50 | Les 50 |
| --- | --- | --- | --- | --- |
| Kanalkampf, CW à 75 % (le lot) | Standard, simple | 20 sur 30 | 12 sur 20 | 32 (64 %) |
| | Réaliste, soigné | 18 sur 30 | 12 sur 20 | 30 (60 %) |
| **Kanalkampf, CW à 70 %** | Standard, rien | 0 sur 30 | 0 sur 20 | 0 |
| | Standard, simple | 23 sur 30 | 16 sur 20 | **39 (78 %)** |
| | Standard, sans chasse | 0 sur 30 | 0 sur 20 | 0 |
| | Réaliste, simple | 17 sur 30 | 14 sur 20 | 31 (62 %) |
| | Réaliste, soigné | 20 sur 30 | 14 sur 20 | **34 (68 %)** |
| Kanalkampf, CW à 66 % | Standard, simple | 25 sur 30 | 17 sur 20 | 42 (84 %) |
| | Réaliste, soigné | 24 sur 30 | 16 sur 20 | 40 (80 %) |
| **Adlertag, chasse à 45 % (le lot)** | Standard, rien | 0 sur 30 | 0 sur 20 | 0 |
| | Standard, simple | 22 sur 30 | 16 sur 20 | **38 (76 %)** |
| | Standard, sans ravitaillement | 0 sur 30 | 0 sur 20 | 0 |
| | Réaliste, simple | 26 sur 30 | 18 sur 20 | 44 (88 %) |
| | Réaliste, soigné | 27 sur 30 | 20 sur 20 | **47 (94 %)** |
| Adlertag, chasse à 44 % | Standard, simple | 26 sur 30 | 17 sur 20 | 43 (86 %) |
| | Standard, sans ravitaillement | 2 sur 30 | 0 sur 20 | 2 |
| **15 septembre, 32 avions (le lot)** | Standard, rien | 0 sur 30 | 0 sur 20 | 0 |
| | Standard, simple | 25 sur 30 | 13 sur 20 | **38 (76 %)** |
| | Réaliste, simple | 21 sur 30 | 16 sur 20 | 37 (74 %) |
| | Réaliste, soigné (en masse) | 20 sur 30 | 14 sur 20 | **34 (68 %)** |
| 15 septembre, 40 avions (le document) | Standard, simple | 12 sur 30 | 5 sur 20 | 17 (34 %) |
| | Réaliste, simple | 10 sur 30 | 11 sur 20 | 21 (42 %) |
| | Réaliste, soigné (en masse) | 20 sur 30 | 14 sur 20 | 34 (68 %) |

Ce que j'en fais :

- **Kanalkampf : le convoi côtier CW se livre à 70 % au lieu de 75 %** (13 navires sur 18 au
  lieu de 14). À 75 %, jouer simple ne gagnait que 64 fois sur cent : c'était trop dur, et
  les dix premières graines (8 sur 10) le cachaient. À 70 %, 78 % ; les graines neuves donnent
  16 sur 20. À 66 % on irait à 84 %, mais le document demandait de *relever* ce seuil (il
  était à 50 %) : je garde la barre la plus haute qui tient la règle.
- **Adlertag : rien ne change.** 76 % sur 50 graines, 16 sur 20 sur les neuves : les 14 sur
  20 du relecteur étaient le bas de la fourchette. Un point de moins (44 %) donnerait 86 % et
  laisserait gagner deux parties sans aucun train.
- **15 septembre : 32 avions, l'écart au document reste.** Le document dit « garder le réglage
  actuel », c'est-à-dire 40 avions. Avec la mesure corrigée des avions abattus (I1), 40 avions
  ne laisse gagner le jeu simple en Standard que 34 fois sur cent, contre la règle « environ
  quatre fois sur cinq » du même document. Les deux consignes ne tiennent pas ensemble ; j'ai
  gardé la règle d'équilibre, qui est aussi la porte du lot, et changé un seul chiffre. C'est
  la première question du compte rendu : revenir à 40 tient en une ligne de
  `data/scenarios/quinze-septembre.json`.
- **« Soigné » le 15 septembre.** La conduite qui gagne ce jour-là en Réaliste est d'engager
  en masse, comme le dit l'aide du scénario ; la prudence qui gagne à Adlertag (deux
  escadrilles par raid, chasses libres laissées) y gagne 18 fois sur 30 à 32 avions et 4 fois
  sur 30 à 40. Le joueur automatique le dit maintenant : `soigne` est « en masse » ce
  jour-là, et la conduite `prudent` reste dans la matrice pour montrer l'écart.

Sur les 50 graines, les trois règles, bataille par bataille : ne rien faire, 0 sur 50 partout ;
jouer simple en Standard, 78 %, 76 % et 76 % ; jouer soigné en Réaliste, 68 %, 94 % et 68 %.

### Mesure finale du M2.10 (19 novembre, 11 h 50 à 12 h 25)

Joueur automatique, **30 graines par conduite** pour les trois batailles et la campagne : 720
parties au commit `4f9af6a` (copie figée, `tools/bot/out/m2.10-final.jsonl`), sans une erreur.
« Avant » est la mesure du M2.9 sur les graines 1 à 10, identique à celle du M2.8.

| Scénario | Préréglage | Conduite | Avant (1 à 10) | Après (1 à 10) | Après (11 à 30) | Après (1 à 30) | Objectifs manqués après |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Kanalkampf | Standard | rien | 0 sur 10 | 0 sur 10 | 0 sur 20 | **0 sur 30** | convois, avions abattus |
| Kanalkampf | Standard | simple | 10 sur 10 | 8 sur 10 | 15 sur 20 | **23 sur 30** | un convoi 6 fois, avions abattus 1 fois |
| Kanalkampf | Standard | sans chasse | 10 sur 10 | 0 sur 10 | 0 sur 20 | 0 sur 30 | avions abattus 30 fois, convois 12 fois |
| Kanalkampf | Réaliste | simple | 10 sur 10 | 8 sur 10 | 9 sur 20 | 17 sur 30 | un convoi 9 fois, avions abattus 5 fois |
| Kanalkampf | Réaliste | soigné | 10 sur 10 | 9 sur 10 | 11 sur 20 | **20 sur 30** | un convoi 9 fois, avions abattus 1 fois |
| Adlertag | Standard | rien | 0 sur 10 | 0 sur 10 | 0 sur 20 | **0 sur 30** | heures hors service, avions abattus, convoi |
| Adlertag | Standard | simple | 9 sur 10 | 8 sur 10 | 14 sur 20 | **22 sur 30** | chasse 8 fois |
| Adlertag | Standard | sans ravitaillement | 10 sur 10 | 0 sur 10 | 0 sur 20 | 0 sur 30 | panne sèche 26 fois |
| Adlertag | Standard | 1 par raid | 5 sur 10 | 1 sur 10 | 0 sur 20 | 1 sur 30 | avions abattus 28 fois, heures hors service 18 fois |
| Adlertag | Standard | 2 par raid | 9 sur 10 | 7 sur 10 | 18 sur 20 | 25 sur 30 | avions abattus 3 fois, heures hors service 2 fois |
| Adlertag | Standard | 4 par raid | 2 sur 10 | 1 sur 10 | 0 sur 20 | 1 sur 30 | chasse 29 fois |
| Adlertag | Réaliste | simple | 10 sur 10 | 9 sur 10 | 17 sur 20 | 26 sur 30 | chasse 4 fois |
| Adlertag | Réaliste | soigné | 10 sur 10 | 10 sur 10 | 17 sur 20 | **27 sur 30** | heures hors service 3 fois |
| 15 septembre | Standard | rien | 0 sur 10 | 0 sur 10 | 0 sur 20 | **0 sur 30** | avions abattus, docks |
| 15 septembre | Standard | simple | 5 sur 10 | 8 sur 10 | 17 sur 20 | **25 sur 30** | avions abattus 5 fois |
| 15 septembre | Standard | 2 par raid | 4 sur 10 | 8 sur 10 | 12 sur 20 | 20 sur 30 | avions abattus 8 fois, docks 2 fois |
| 15 septembre | Standard | 4 par raid | 10 sur 10 | 10 sur 10 | 20 sur 20 | 30 sur 30 | — |
| 15 septembre | Réaliste | simple | 7 sur 10 | 8 sur 10 | 13 sur 20 | 21 sur 30 | avions abattus 9 fois |
| 15 septembre | Réaliste | soigné (en masse ce jour-là) | 9 sur 10 | 9 sur 10 | 11 sur 20 | **20 sur 30** | chasse 10 fois |
| 15 septembre | Réaliste | prudent (le « soigné » d'avant) | 1 sur 10 | 5 sur 10 | 13 sur 20 | 18 sur 30 | avions abattus 12 fois |
| Campagne | Standard | simple | 0 sur 10 | 5 sur 10 | 3 sur 20 | 8 sur 30 | 16 chaînes arrivent au 15 septembre |
| Campagne | Réaliste | simple | 0 sur 10 | 0 sur 10 | 0 sur 20 | 0 sur 30 | 14 chaînes arrivent au 15 septembre |
| Campagne | Réaliste | soigné | 0 sur 10 | 8 sur 10 | 5 sur 20 | 13 sur 30 | 18 chaînes arrivent au 15 septembre |
| Campagne | Réaliste | simple, puis en masse le 15 | 4 sur 10 | 6 sur 10 | 4 sur 20 | 10 sur 30 | 14 chaînes arrivent au 15 septembre |

(« Avant », la conduite en masse du 15 septembre gagnait 9 fois sur 10 et la conduite prudente
1 fois sur 10 : la seconde s'appelait alors « soigné ».)

**La campagne est trois victoires de suite, sans rejouer une bataille perdue** : avec des
batailles gagnées trois fois sur quatre, une chaîne sur deux arrive au bout, pas davantage.
Mais la mesure montre autre chose, que les dix premières graines cachaient : **en campagne, le
15 septembre est plus dur que seul**. La chasse y commence avec ce qu'Adlertag a laissé
(75 à 79 % en Standard, 60 à 72 % en Réaliste) et les 32 avions à abattre ne changent pas.
Jouer simple y gagne 8 fois sur 16 en Standard et jamais en Réaliste (0 sur 14) ; engager en
masse y gagne 13 fois sur 18. L'objectif de chasse est déjà mesuré sur les avions présents au
début (I1) ; celui des avions abattus ne l'est pas. Je n'y touche pas dans ce lot — c'est une
règle, pas un seuil — et je le pose en question au compte rendu.

**Atlantique** : le lot n'y change rien (`git diff` vide sur `src/sim`, les règles et le
scénario depuis la mesure du M2.9) ; les 100 parties mesurées au commit `efc6bb7` sont
identiques une à une à celles du M2.8.

**Autres mesures, machine au repos** : pas de simulation le plus long, 15,1 ms sur dix parties
(aucun au-delà de 20 ms ; `tools/bot/perf.mjs`) ; 59,6 images par seconde à ×14 400, fiche
ouverte ou non, aucune image au-delà de 50 ms (`tools/smoke/fps.mjs`).

### 19 novembre, 12 h 25 à 12 h 55 — l'Atlantique sur dix graines neuves

Ce qui valait pour les batailles aériennes valait pour la mer : le réglage du M2.8 avait été
fait et mesuré sur les graines 1 à 10. J'ai donc rejoué les dix conduites sur les graines 11
à 20 (100 parties, même commit ; `tools/bot/out/m2.10-atl.jsonl`). Le lot M2.10 ne change
rien à la mer : c'est une vérification du M2.8, faite ici parce que la porte du M2.10 dit
« partout ».

| Préréglage | Conduite | Graines 1 à 10 | Graines 11 à 20 | Les 20 | Avec le seuil du document (8 %) |
| --- | --- | --- | --- | --- | --- |
| Standard | rien | 0 sur 10 | 0 sur 10 | **0 sur 20** | 0 sur 20 |
| Standard | simple (Rester, le défaut) | 9 sur 10 | 8 sur 10 | **17 sur 20** | 18 sur 20 |
| Standard | Chasser | 9 sur 10 | 8 sur 10 | 17 sur 20 | 19 sur 20 |
| Standard | Chasser, grenadage économe | 8 sur 10 | 9 sur 10 | 17 sur 20 | 18 sur 20 |
| Standard | soigné | 9 sur 10 | 10 sur 10 | 19 sur 20 | 20 sur 20 |
| Standard | deux avions achetés le premier jour | 3 sur 10 | 0 sur 10 | 3 sur 20 | 3 sur 20 |
| Réaliste | Rester | 5 sur 10 | 4 sur 10 | 9 sur 20 | 10 sur 20 |
| Réaliste | Chasser | 2 sur 10 | 5 sur 10 | 7 sur 20 | 14 sur 20 |
| Réaliste | soigné | 7 sur 10 | 3 sur 10 | **10 sur 20** | 15 sur 20 |

Arrêts par partie : 42 à 59 sur les graines 1 à 10 en Standard (moyenne 51), 44 à 66 sur les
graines 11 à 20 (moyenne 54) ; en Réaliste 47 à 61, puis 44 à 64. **Sur les cent parties
neuves, dix dépassent la cible de 60 arrêts, de un à six arrêts.**

Ce que cela dit, sans fard :

- « Ne rien faire perd » et « jouer simple gagne environ quatre fois sur cinq en Standard »
  tiennent dans l'Atlantique sur vingt graines (0 et 17 sur 20).
- « Aucune conduite sûre de gagner » tient aussi : la meilleure est à 19 sur 20.
- **« Jouer soigné gagne en Réaliste » n'y tient qu'à moitié : 10 sur 20.** Les dix premières
  graines disaient 7 sur 10. Les pertes de cette conduite tournent autour du seuil (de 3,9 à
  9,8 %, médiane 7,5 %) : un navire de plus ou de moins fait le verdict.
- Le seuil du document, 8 %, que j'avais abaissé à 7,5 % au M2.8 pour qu'aucune conduite ne
  gagne à coup sûr, donnerait 15 sur 20 au jeu soigné en Réaliste, mais 20 sur 20 au jeu
  soigné en Standard. Aucun seuil unique ne tient les deux à la fois ; l'idée C de l'audit
  (bronze, argent, or), remise à plus tard, est faite pour cela.
- La cible de 30 à 60 arrêts du M2.8 est tenue en moyenne (51 à 54), pas par chaque partie.

Je ne retouche pas la mer à la dernière heure : un nouveau réglage demande une règle, pas un
seuil, puis 200 parties de quarante secondes à chaque essai. C'est dit au compte rendu, avec
les chiffres, et posé en question.

### Porte du M2.10

Critère du document : « les trois règles d'équilibre tenues partout ; tutoriel joué de bout en
bout ».

- **Tutoriel joué de bout en bout : tenu.** L'essai de fumée joue les quatre leçons du menu à
  leur dernière étape, avec les gestes d'un élève (tracé, train, stock minimum, bouton du
  rapport de quart, consigne, repos, rappel), et les marque faites. Durées : 4,9 · 3,7 · 3,6 ·
  3,3 minutes à une première lecture.
- **Ne rien faire perd nettement, dans chaque scénario : tenu.** 0 sur 50 dans les trois
  batailles, 0 sur 20 dans l'Atlantique.
- **Jouer simple gagne environ quatre fois sur cinq en Standard : tenu de près, par le bas.**
  Kanalkampf 39 sur 50, Adlertag 38 sur 50, 15 septembre 38 sur 50, Atlantique 17 sur 20.
- **Jouer soigné gagne en Réaliste, pas forcément au premier essai : tenu dans les trois
  batailles, à moitié dans l'Atlantique.** Kanalkampf 34 sur 50, Adlertag 47 sur 50,
  15 septembre 34 sur 50 ; Atlantique 10 sur 20.
- **À chaque lot** : branche `m2.10` et demande de fusion ; 385 tests, lint et
  construction de `dist/index.html` verts ; aucun test affaibli (une borne a suivi une règle
  changée exprès, voir plus haut) ; déterminisme (mêmes graine et ordres, même monde,
  sauvegarde et reprise comprises) ; joueur automatique avant et après, sur 30 graines et non
  10 pour les batailles ; 10 000 ordres au hasard par scénario, avec sauvegardes et reprises ;
  essai de fumée complet (223 vérifications, développement et fichier unique ouvert
  depuis le disque) ; README à jour.

**La porte est franchie pour l'essentiel, avec trois réserves que je ne veux pas enrober** :
le jeu simple en Standard est plutôt à trois fois sur quatre qu'à quatre fois sur cinq ; le
15 septembre tient sa règle au prix d'un écart au document (32 avions au lieu de 40) ; et
dans l'Atlantique, jouer soigné en Réaliste ne gagne qu'une fois sur deux sur vingt graines.

**Ce qui reste ouvert dans ce lot** : en campagne, le 15 septembre est plus dur que seul (les
avions à abattre ne suivent pas la chasse reportée) ; les suites de la relecture n'ont pas été
relues par un second agent ; à 1 024 px, fiche ouverte, il reste 284 px de carte ; aucun
humain n'a joué l'équilibre, qui est mesuré au joueur automatique.

**Écarts au document, pour le compte rendu** : 15 septembre à 32 avions ; conduite « soignée »
en masse ce jour-là ; convoi côtier de Kanalkampf à 70 % ; Adlertag en heures hors service
cumulées et bases à 40 % de carburant ; vol moins fatigant ; alertes à décider qui se ferment
à l'ordre et que « Voir » ne ferme pas ; convoi escorté en pile qui garde sa plaque ; mot de
la carte sur un glisser depuis une pile fermée ; pas d'ordre pendant une démonstration ;
Effectifs masqué sans escadrille de chasse ; tutoriel d'origine remplacé par quatre leçons.

## Idée B · En mer, la zone de patrouille plutôt que l'avion

Faite en fin de session, les quatre lots livrés, comme le demandait la consigne. Branche
`idee-b`, partie de `m2.10` ; version 2.10.1. C'est la version « affichage seul » de l'audit
(une journée de travail estimée) : la simulation fait voler les avions comme avant, et les
720 parties de la mesure n'ont pas à être rejouées (`git diff m2.10 -- src/sim data/rules.json
data/scenarios` est vide).

**Le constat de l'audit.** À ×3 600, un avion de patrouille à 250 km/h parcourt 250 km de
carte par seconde, un convoi à 9 nœuds en parcourt 17 : l'avion clignote, le convoi rampe.

**Ce qui est fait.**

- `src/ui/patrolZone.js`, sans rien de la page : pour une patrouille de Coastal Command en
  vol, `patrolZone` donne l'endroit où se tient son repère (le convoi qu'elle couvre, le bout
  de sa route ou de ses étapes, le point où elle orbite, son aérodrome quand elle rentre), le
  rayon de son cercle (ce qu'elle voit de jour d'un U-Boot en surface, plus le rayon du cercle
  volé autour d'un convoi), ce qu'elle en surveille en ce moment (tout de jour, la courte
  portée de son radar ASV la nuit, rien la nuit sans radar ni sur le retour), et le chemin
  qu'elle suit. `shownAsZone` dit quand on la dessine ainsi : à
  partir de ×600, jeu en marche ou en pause (l'image ne bascule pas à chaque arrêt), jamais
  pour l'unité en main, et seulement si la case des Réglages est cochée.
- La scène dessine les zones sous les unités : cercle bleu, hachuré là où la patrouille voit
  (sur l'autre pente que les hachures rouges des zones de radiogoniométrie, ancrées sur la
  carte), contour en pointillé quand elle ne voit pas tout son cercle ; bande hachurée le long
  du chemin quand elle y voit ; trait pointillé du chemin. Le repère de l'escadrille (son symbole et une plaque qui
  dit « couvre HX 102 », « va couvrir HX 102 », « en route », « en patrouille », « rentre »)
  se tient à la zone : c'est là qu'on la clique et qu'on glisse depuis elle. Deux patrouilles
  sur le même convoi font une pile, comme toutes les unités superposées.
- **Sous silence radio, la zone d'une patrouille qui couvre un convoi se dessine autour de la
  position que la table donne au convoi**, pas autour de sa position vraie : l'avion, lui,
  tournait au-dessus du convoi réel et le trahissait. L'idée B ferme cette fuite à grande
  vitesse.
- Réglages, onglet Carte et fiche : « Patrouilles en mer : à partir de ×600, la zone
  couverte… ». Réglage d'affichage du joueur, hors de la partie et des sauvegardes.
- Aide (onglet Mer), README.

**Choix.**

- *Coastal Command seulement* (« en mer ») : les sections de guet au-dessus de la Manche
  gardent leur avion, on les suit à ×10 ou ×60.
- *La vitesse choisie décide, pas la pause.* Dans l'Atlantique le jeu s'arrête aux relèves
  sans changer de vitesse : si la pause ramenait les avions, l'image basculerait à chaque
  arrêt.
- *L'échelle est la vraie.* Vue de l'Atlantique entier, un cercle de 24 km fait moins de
  quatre pixels : il n'est pas dessiné, le repère et sa plaque suffisent. Je n'ai pas grossi
  la zone pour la rendre visible : elle mentirait sur ce qui est surveillé.
- *L'unité en main retrouve son avion*, sa route et ses carrés : ses ordres en ont besoin.

**Ce qui n'est pas fait.** La version « simulation » de l'idée (trois à quatre jours selon
l'audit), où la patrouille serait résolue par zone et non par un avion qui vole : rien n'y
est engagé. Une patrouille qui vole un cap sans fin garde son avion pour repère (cas rare).

**Essais.** `tests/patrolzone.test.js` : six tests (au sol ou chasseur, pas de zone ; sur une
route ; au-dessus d'un convoi, qui suit le convoi ; en orbite et sur le retour ; la nuit sans
radar puis avec ; quand elle est dessinée). Essai de fumée : une patrouille envoyée sur un convoi, à
×3 600 son repère est à côté du convoi et sa zone est là ; à ×60 l'avion ; en main, l'avion ;
case décochée, l'avion. Captures `patrol-zone` et `patrol-aircraft`.

## Retours de jeu · version 2.10.2

Les quatre lots et l'idée B livrés, Florian joue la 2.10.1 dans l'artefact « travaux de
Fable ». Son message du 19 novembre, 13 h 47, apporte deux demandes nées du jeu, une décision
sur une question du compte rendu, et la confirmation de plusieurs choix. Branche
`retours-jeu`, partie de `idee-b` ; version 2.10.2.

### 19 novembre, 14 h 55 à 15 h 35 — ce qui a été fait

**1. États d'alerte et planning pour tout ce qui vole.** Le constat de Florian, en jouant
« Hiver dans l'Atlantique » : « une reconnaissance et l'escadrille est déjà fatiguée et ne
remonte pas », et rien pour la mettre au repos. Ce que j'ai trouvé en lisant le code :

- La simulation ne fait aucune différence entre les rôles. Une patrouille se fatigue en vol
  (4 points par heure) comme un chasseur, son état d'alerte règle son délai de décollage, et
  son planning s'applique (`crews.js`, `roster.js`, `orders.setAlert` : aucun test du rôle).
- L'interface, elle, réservait tout à la chasse : boutons d'état d'alerte dans la fiche, page
  Effectifs, onglet Effectifs d'un aérodrome, copie d'un plan. Et la relecture du 2.10 avait
  masqué le bouton Effectifs là où il n'y a pas de chasseur (la page s'ouvrait vide), donc
  dans tout l'Atlantique.
- Laissée à son état de départ (Alerte à 5 minutes, +0,1 point par heure), une patrouille ne
  récupère jamais. Une sortie de Sunderland (13 h d'autonomie) coûte 53 points, une de
  Catalina (18 h) 73 : fatiguée dès la première, épuisée à la deuxième, pour toujours. C'est
  exactement ce que Florian a vu. Le journal lui disait en plus « elle se bat moins bien.
  Mettez-la au repos dès que possible », ce qu'il ne pouvait pas faire.

Ce qui est fait : les limites « chasse seulement » sont levées dans `panels.js`
(`tiredText`, `alertBlock`, `rosterTab`), `rosterPage.js`, `actions.js` (copie d'un plan) et
`offered.js` (le bouton Effectifs est offert dès qu'il y a de la fatigue et une escadrille).
La page Effectifs montre le type d'avion et la fatigue de chaque escadrille, pour voir d'un
coup d'œil qui a besoin de repos. Le journal a une phrase pour une patrouille fatiguée ou
épuisée, qui dit comment la reposer sans lui prêter de combat, et son épuisement n'est plus
une alarme rouge. La leçon de l'escorte, qui a un Whitley mais n'enseigne pas les états
d'alerte (c'est la leçon 4), se joue désormais sans fatigue : rien n'y change à l'écran.

**Ce que je n'ai pas changé, et qu'il faut savoir : la fatigue d'une patrouille ne change
pas ce qu'elle voit.** La fatigue ne pèse que sur le combat aérien (`formFactor` et
`lossFactor` dans `combat.js`), et une patrouille ne se bat pas : ni la portée de vue
(`patrols.js`), ni la chasse aux U-Boote (`asw.js`) ne lisent la fatigue. Le planning des
patrouilles est donc, à ce jour, un geste sans enjeu dans les règles ; l'aide le dit (« une
patrouille fatiguée voit aussi loin qu'une autre »). Donner un effet à cette fatigue (une
patrouille fatiguée verrait moins loin) est une règle nouvelle qui toucherait l'équilibre de
l'Atlantique, mesuré et validé : le joueur automatique « soigné » fait voler ses patrouilles
chaque jour sans jamais les reposer, il faudrait lui apprendre le repos de nuit et rejouer
les mesures. Je pose la question à Florian plutôt que de le faire sans lui.

**2. Onglets d'une installation qui abrite des unités.** Demande : « afficher le port et les
étiquettes d'unités », comme pour les unités superposées. `src/ui/siteUnits.js`, sans rien de
la page : `unitsIn` (les escadrilles au sol d'un aérodrome, y compris celles appelées à leurs
avions ; les groupes d'escorte au port, en ravitaillement ou en train d'appareiller, et les
convois à quai), `siteOfSelection` (l'installation en main, ou celle où se tient l'unité en
main) et `siteTabs` (l'installation d'abord, puis un onglet par unité). La fiche les dessine
dans la bande d'onglets des piles. Choix :

- Les onglets valent dans les deux sens : port en main ou unité du port en main, les mêmes
  onglets, pour qu'on puisse revenir. Un clic sur la pile de groupes à côté d'un port ouvre
  donc aussi l'onglet du port, qui était difficile à atteindre sous la pile.
- Les groupes d'un groupe de soutien font un onglet, qui sélectionne le groupe de soutien,
  comme sur la carte. Les escadrilles gardent un onglet chacune, même en big wing : une wing
  se rassemble depuis plusieurs aérodromes.
- Une unité de la pile de la carte qui n'est pas dans l'installation (un convoi qui passe
  devant le port) garde son onglet, après les autres.
- Un port étranger (Halifax, Sydney) n'a pas de fiche, donc pas d'onglets.
- Les trains en chargement dans un dépôt ne sont pas des onglets : ce ne sont pas des unités
  qu'on commande, et un dépôt en charge plusieurs à la fois.
- La fiche d'un port liste maintenant les navires au port, comme celle d'un aérodrome liste
  ses escadrilles.

**3. Campagne : les avions à abattre suivent la chasse reportée.** Décision de Florian sur
la question 2 du compte rendu : « que le nombre d'avions à abattre suive la chasse reportée
d'Adlertag, comme l'objectif de chasse depuis le M2.7. C'est la même logique : on doit
pouvoir gagner. » `createObjectives` ramène le compte d'un objectif « enemyDown » à la part
des chasseurs présents au matin (compte × présents ÷ dotation, arrondi), une fois, au début
de la bataille ; `full` garde le compte du scénario. Choix :

- La règle vaut pour toute bataille commencée avec un report, donc aussi pour Adlertag après
  Kanalkampf (90 avions à effectif complet) : une seule logique, celle de l'objectif de
  chasse. Florian parlait du 15 septembre ; l'effet sur Adlertag est mesuré ci-dessous.
- La part est celle réellement présente, escadrille par escadrille (58 % pour un report de
  60 %), la même que dit le briefing.
- Une relève qui arrive en cours de bataille ne change pas le compte.
- Une bataille de campagne commencée avant la 2.10.2 et reprise d'une sauvegarde garde le
  compte avec lequel elle a commencé : les objectifs reviennent tels qu'ils ont été gardés.
  Le format de sauvegarde ne change pas (champ facultatif, noté dans `migrate.js`).

**Décisions de Florian sans changement de code** : 32 avions le 15 septembre (40 pourra
servir à une médaille d'argent) ; seuil de pertes de l'Atlantique gardé à 7,5 % ; aucun
arrêt retiré dans l'Atlantique ; sauvegardes automatiques, réglages d'affichage et
« Recommencer » restent comme livrés. L'idée B reste du lot, et se coupe dans les Réglages.

**Un test dont l'énoncé a changé.** `tests/review29.test.js` affirmait que le bouton
Effectifs n'est pas offert dans l'Atlantique ni dans la leçon de l'escorte. C'était la règle
voulue par la relecture du 2.10 ; Florian demande l'inverse pour l'Atlantique. L'assertion
dit maintenant la règle demandée (offert dans l'Atlantique avec fatigue, absent sans
fatigue, absent sans aucune escadrille, absent de la leçon de l'escorte parce qu'elle se
joue sans fatigue). Ce n'est pas un test affaibli pour passer : c'est le comportement
demandé qui a changé, et il a ses propres tests.

**Essais.** 406 tests (391 avant) : `tests/patrolrest.test.js` (six : une patrouille se
repose et se rappelle comme un chasseur ; depuis le repos elle part deux heures après
l'ordre ; son plan du jour ; la page liste toutes les escadrilles ; les phrases du journal ;
trois jours du rythme « repos la nuit »),
`tests/siteunits.test.js` (six : aérodrome, installation vide, port, port étranger, groupe
de soutien, pile de la carte), `tests/campaign.test.js` (trois de plus : le compte suit la
chasse reportée, il est jugé et gardé, il est dit). Essai de fumée : 246 vérifications (228
avant), dont les états d'alerte d'un Whitley dans l'Atlantique, la page Effectifs sur les
patrouilles, les onglets de Liverpool et de Tangmere, le briefing de campagne (« 19 au lieu
de 32 »). Captures `patrol-alert`, `patrol-roster`, `site-tabs-port`, `site-tabs-group`,
`site-tabs-airfield`, `site-tabs-squadron`, `briefing-campaign`, `objective-campaign`.
Ordres au hasard : 10 000 par scénario, sans erreur.

### Mesure de la campagne après la 2.10.2 (19 novembre, 15 h 37 à 15 h 50)

Les quatre lignes de campagne rejouées sur les trente graines de la mesure finale du M2.10
(120 chaînes, `node tools/bot/measure.mjs --name retours --seeds 30 --only campagne`). Une
chaîne, c'est Kanalkampf, Adlertag puis le 15 septembre, sans rejouer une bataille perdue.

| Préréglage | Conduite | Kanalkampf gagné | Adlertag gagné | 15 septembre gagné, avant → après | Campagne gagnée, avant → après |
| --- | --- | --- | --- | --- | --- |
| Standard | simple | 23 sur 30 | 16 sur 23 | 8 → **14 sur 16** | 8 → 14 sur 30 |
| Réaliste | simple | 17 sur 30 | 14 sur 17 | 0 → **11 sur 14** | 0 → 11 sur 30 |
| Réaliste | soigné (en masse le 15) | 20 sur 30 | 18 sur 20 | 13 → 13 sur 18 | 13 → 13 sur 30 |
| Réaliste | simple, puis en masse le 15 | 17 sur 30 | 14 sur 17 | 10 → 10 sur 14 | 10 → 10 sur 30 |

Ce que la mesure dit :

- **Le 15 septembre se gagne en campagne à peu près comme seul.** Joué simplement en
  Standard : 14 fois sur 16 en campagne (25 sur 30 seul). En Réaliste : 11 sur 14 (21 sur 30
  seul). La chasse y commence à 75 à 79 % de ses avions en Standard (24 avions demandés) et
  à 60 % en Réaliste (19 demandés) ; les parties jouées simplement en abattent de 21 à 42 et
  de 11 à 30.
- **Les 17 chaînes qui changent d'issue sont toutes des 15 septembre perdus faute d'avions
  abattus**, et gagnés maintenant. Aucune autre bataille ne change : Kanalkampf est la
  première, et Adlertag commence avec 93 à 100 % de sa chasse (les usines ont comblé les
  vides de Kanalkampf), soit 83 à 90 avions demandés pour 90 à 162 abattus. La règle vaut
  pour Adlertag, mais elle n'y décide de rien dans ces 120 chaînes : ses défaites tiennent à
  la chasse gardée et aux heures hors service.
- **En masse le 15, rien ne bouge** : ces journées abattent 34 à 58 avions, bien au-delà du
  compte ; elles se perdent sur la chasse gardée (moins de 70 % des présents), ce que la
  règle ne touche pas. Jouer simple et jouer en masse se valent donc ce jour-là en campagne
  (11 et 10 sur 14) : l'un risque de ne pas abattre assez, l'autre de trop perdre.
- La campagne entière reste difficile : 14 sur 30 en Standard joué simplement. Ce sont trois
  victoires de suite, et Kanalkampf puis Adlertag en arrêtent déjà 14.

**Hors campagne, rien ne change**, et c'est vérifié : `git diff idee-b -- src/sim
data/rules.json data/scenarios` ne touche que `objectives.js` et `world.js`, pour la règle
ci-dessus ; quinze parties rejouées (Kanalkampf, Adlertag, 15 septembre en Standard simple,
15 septembre en Réaliste soigné, Atlantique en Standard soigné avec ses patrouilles, trois
graines chacune) sont identiques une à une à celles de la mesure du M2.10. Le joueur
automatique note maintenant, pour chaque bataille d'une chaîne, le nombre d'avions demandé
(`asked`).

### 19 novembre, 15 h 50 à 16 h 05 — le rythme que Florian veut jouer, simulé

« Pouvoir les mettre au repos la nuit » : j'ai fait tourner ce rythme trois jours dans
l'Atlantique, pour vérifier que le planning le tient de bout en bout, et j'en ai fait un test.
Plan du jour : au repos à 18:00, disponible (30 min) à 06:00 ; une sortie ordonnée chaque
matin à 09:00, en l'air trente minutes plus tard, aussi longue que l'autonomie le permet.

| Avion | Heures de vol par sortie | Fatigue au matin | Fatigue en fin de sortie, premier jour puis suivants |
| --- | --- | --- | --- |
| Hudson | 5,9 | 0 | 36, puis 27 |
| Whitley | 8,9 | 0 | 47, puis 39 |
| Sunderland | 12,9 | 0 | 63, puis 55 |

Le planning tient : l'ordre de repos de 18:00 donné pendant le vol s'applique à
l'atterrissage, et l'escadrille repart fraîche chaque matin. Le premier jour elle part des
10 points du scénario : un Sunderland finit alors sa sortie à 63, fatigué une heure ou deux,
puis ne repasse plus les 60. Sans planning, laissée en Alerte à 5 minutes, la même
escadrille est fatiguée après une sortie (64 au matin suivant) et à 100 dès le troisième
matin : c'est ce que Florian a vu. Le Catalina (18 h d'autonomie, 73 points) ne tiendrait pas une
sortie pleine par jour ; il n'y en a pas dans le scénario au départ, on peut en acheter.

### Porte des retours de jeu

406 tests, lint et construction verts ; 246 vérifications à l'essai de fumée, sur la version
de développement et sur `dist/index.html` ; 10 000 ordres au hasard par scénario ; mesure de
la campagne ci-dessus. Branche `retours-jeu`, demande de fusion nº 6, vérifications de GitHub
vertes. Artefact « Jeu 1940 — travaux de Fable » mis à jour (2.10.2). Non relu par un agent
neuf.

## Retours de jeu, deuxième tour · version 2.10.3

Message de Florian du 19 novembre, 17 h 18, après ses essais de la 2.10.2. Trois choses :

- sur la fatigue des patrouilles, qui ne change rien à ce qu'elles voient (ma question du
  tour précédent) : « Alors on reste ainsi, cela nous entraine à gérer nos équipes. » Aucune
  règle ne change ;
- « peux-tu contrôler la programmation des appareillage des groupe d'escorte, ils me semble
  qu'ils ne réagissent pas aux heures de départ fixé » ;
- « si je lui dis de sortir par le chenal Irlande, St george ou rester en bord du port, cela
  devient une étape, comme celle tracée. De ce fait je peux la supprimer ou lui ajouter des
  futur itinéraire au bout, comme je peux fixer une action au bout de cette première action. »

Branche `retours-jeu-2`, partie de `retours-jeu` ; version 2.10.3.

### 19 novembre, 17 h 20 à 18 h 40 — ce qui a été trouvé et fait

**1. L'appareillage programmé qui ne partait pas : reproduit, corrigé.** Avec « Sortie :
chenal Nord de l'Irlande » puis « Appareillage programmé 08:00 », sans tracé ni étapes,
le groupe restait au port. `runSail` (`timetable.js`) exigeait une route ou des étapes : à
l'heure dite il levait « l'ordre programmé attend (ni route ni étapes) », et recommençait
chaque minute sans jamais partir. Le bouton « Appareiller », lui, faisait partir le même
groupe par son chenal. Reproduit dans la simulation, puis dans la page. Corrigé : à son
heure, un groupe d'escorte appareille exactement comme sur le bouton (`sailEscort`), avec
ce qui est préparé, ou en rade s'il n'y a rien, où il attend ses ordres. Un convoi garde sa
règle : sans route ni étapes il n'a nulle part où aller, son ordre attend.

**2. Un second défaut, trouvé en lisant le code des routes.** Un groupe sorti du port sur
un tracé ne pouvait ni voir ses points déplacés, ni voir son tracé prolongé, tant qu'il
descendait son chenal de sortie. `routeConvoy` rangeait le nombre de points du chenal de
sortie dans `routeLocked`, qui compte les derniers points de la route (le chenal d'entrée
dans un port) : la sortie était verrouillée au mauvais bout. Le chenal de sortie a
maintenant son propre compte, en tête de route (`routeHead`, qui baisse à chaque point
passé) ; `routeLocked` ne compte plus que le chenal d'entrée.

**3. La sortie du port devient une étape.** Ce que j'ai compris de la demande, et fait :

- Choisir une sortie dans la section Au port (« en rade », ou un chenal) pose la première
  étape des ordres du groupe : la tête d'une route qui attend au port (`planExit`,
  `convoy.js`). « Aucune » la retire.
- Elle se voit : dessinée sur la carte pour le groupe en main ou programmé, et inscrite
  sous « Route et étapes » (« Par le chenal : Nord de l'Irlande · 484 km », « En rade, au
  large du port · 3,8 km »), avec une croix pour la retirer. Cette section remonte juste
  sous la section Au port tant que le groupe y est.
- Elle se prolonge : un tracé tiré à la souris depuis l'anneau dessiné à son bout, ou des
  étapes au cap, qui partent de son bout (`planTrack`). Le tracé a sa ligne dans la liste
  (« Puis le tracé : 2 points · 241 km ») et sa propre croix, qui laisse la sortie.
- Elle a sa fin : « Au bout de la sortie » offre les mêmes choix qu'une fin de tracé
  (attendre, garder le cap, chercher un U-Boot, rejoindre un convoi, entrer dans un port).
- Rien ne part avant « Appareiller » ou l'heure programmée.

Les choix que j'ai faits là où la demande ne tranchait pas, à confirmer par Florian :

- Poser une étape de sortie fait attendre le groupe au port, même sans heure programmée :
  on prépare, puis on appareille. Sans sortie choisie, rien ne change : un tracé tiré depuis
  le port est toujours un ordre de partir tout de suite.
- Changer de sortie garde le tracé qui la suit, rejoint par la mer depuis le nouveau bout ;
  s'il ne se rejoint pas, il est effacé et la fiche le dit. Retirer la sortie retire aussi
  le tracé, qui partait de son bout. Les étapes au cap restent : elles partent d'où la
  sortie finit, quelle qu'elle soit.
- « Rejoindre » un convoi depuis le port reste un ordre de partir maintenant, par le chenal
  qui mène au convoi : il remplace ce qui était préparé.
- La sortie vaut pour une sortie en mer : de retour au port, elle est oubliée.
- Il n'y a qu'une action de fin, au bout de tout (sortie, puis tracé ou étapes). Une chaîne
  d'actions (une action, puis une route, puis une autre action) n'existe pas : c'est une
  autre demande, plus grosse, si elle est voulue.

**Sauvegardes.** Deux champs de plus sur un groupe d'escorte, lus avec leur valeur par
défaut (`routeHead`, `exitPlanned`) : le format reste le 2. Ce que la 2.10.2 écrivait à
leur place est relu au premier pas de jeu (`adoptWayOut`) : un groupe qui attendait au port
avec son chenal choisi retrouve son étape et appareille ; un groupe enregistré pendant qu'il
descendait son chenal retrouve son tracé modifiable.

**Une vraie partie de la 2.10.2.** Les trois états ci-dessus étaient d'abord imités dans
les tests (les champs réécrits à la main). Pour ne pas me fier à mon imitation, j'ai repris
le code de la 2.10.2 dans un répertoire à part, et je lui ai fait enregistrer une partie de
l'Atlantique avec quatre groupes laissés comme un joueur pouvait les laisser
(`tests/fixtures/make-save-2.10.2.mjs`) : l'EG 1 avec son chenal choisi et un appareillage
dont l'heure est passée (« ordre en attente »), l'EG 3 avec un chenal, une heure à venir et
un tracé qui attend, l'EG 2 en train de descendre son chenal sur un tracé, l'EG 4 en rade.
Reprise par la 2.10.3 (`tests/oldsaves.test.js`) : l'EG 1 appareille dans les deux minutes,
en retard comme l'alerte le disait ; l'EG 3 garde sa route point pour point, avec sa sortie
et son tracé distingués, et part à son heure ; les points du tracé de l'EG 2 se déplacent de
nouveau. Passé du premier coup.

**Tests.** `tests/exitstep.test.js`, 14 tests : l'appareillage programmé sans rien de
préparé ; l'étape posée, changée, retirée ; le tracé et les étapes après elle ; sa fin
(garder le cap, port, convoi) ; le tracé d'un groupe en mer ; le retour au port et
« Rejoindre » ; trois états de sauvegarde de la 2.10.2 ; l'aller-retour d'un plan qui
attend ; le groupe de soutien. Le test du tableau des actions (`tests/menus.test.js`) a
refusé mes deux croix, écrites par une fonction commune qu'il ne lisait pas : je les ai
écrites en clair plutôt que d'assouplir le test.

**Singe.** Deux ordres de plus (une sortie au hasard, y compris un chenal qui n'existe pas ;
le tracé après la sortie rallongé ou effacé) et une vérification après chaque ordre : le
début de route compté comme sortie doit suivre un chenal d'un port, point pour point. Elle
m'a fait chercher tous les endroits où la route d'un groupe est remplacée (chasse, retour
au port, pilote, rendez-vous, contournement d'un cap) pour y remettre le compte à zéro. Pour
m'assurer qu'elle voit quelque chose, j'ai retiré deux de ces remises à zéro : le singe l'a
signalé au bout de 594 ordres. Remises en place.

**La simulation est-elle la même pour le joueur automatique ?** Oui. 36 parties rejouées
(les dix conduites de l'Atlantique, Kanalkampf et Adlertag en jeu simple, trois graines
chacune) et comparées à la mesure du M2.10 : 36 identiques (issue, navires perdus, U-Boote
coulés, carburant, arrêts, objectifs). Le joueur automatique n'utilise ni sortie choisie ni
appareillage programmé : il fait « Rejoindre » depuis le port, dont le trajet n'a pas changé.

### Porte du deuxième tour

421 tests, lint et construction verts ; 260 vérifications à l'essai de fumée (14 de plus :
la sortie posée, prolongée à la souris, retirée, deux appareillages programmés à 08:00, l'un
avec une étape, l'autre sans rien), sur la version de développement et sur
`dist/index.html` ; 10 000 ordres au hasard par scénario, et 30 000 de plus dans
l'Atlantique (trois parties : Standard graine 2, Réaliste graines 2 et 3) ; 36 parties du
joueur automatique identiques. Branche `retours-jeu-2`, demande de fusion nº 7,
vérifications de GitHub vertes (commit 175ff26, le dernier avant cette ligne). Artefact
« Jeu 1940 — travaux de Fable » mis à jour (2.10.3) ; compte rendu du projet complété. Essayé
aussi sous silence radio, à la souris : au port et dans le chenal, les ordres sont immédiats.
Non relu par un agent neuf.

## Retours de jeu, troisième tour · version 2.10.4

Message de Florian du 19 novembre, 21 h 15. Deux demandes, et une consigne sur la méthode :

- « si je tire une route quand un bateau est en haute mer, vu qu'on attend le prochain [quart]
  pour la lui transmettre, et bien elle disparaîtra de la carte quand je clic sur enregistrer.
  Du coup c'est difficile d'[appondre] un deuxième itinéraire voir un troisième, est il
  possible quelle reste sur la carte mais éventuellement avec une autre couleur jusqu'à ce
  qu'elle soit transmise au quart suivant ? »
- les rapports de quart avec décision, en fenêtre : « quand je la ferme, sans choisir car je
  veux analyser la situation, il est impossible de rouvrir ce pop-up. […] Peut on depuis la
  Side box rouvrir ce pop-up ? Exactement pareil ? Avec éventuellement un bouton, voir un
  bouton en menu en haut ? »
- « Pas besoin de faire une simulation à 10000 tests. »

Branche `retours-jeu-3`, partie de `retours-jeu-2` ; version 2.10.4.

### 19 novembre, 21 h 15 à 22 h — ce qui a été trouvé et fait

**1. Ce que devenait un ordre de route en attente.** Sous silence radio, un ordre à un navire
en haute mer attend la relève dans `world.signals`. J'ai regardé ce que la page en montrait :

- un tracé tiré à la souris n'était dessiné que pour le navire en main, en pointillé pâle
  (bleu à 50 %, tirets 2-6) ; l'unité lâchée, plus rien ;
- des étapes au cap n'étaient montrées nulle part : ni dans la liste de la fiche, qui lit le
  plan du navire, ni sur la carte. « Enregistrer » est le bouton de la fiche des étapes : c'est
  sans doute ce cas que Florian décrit. La règle posée pour mesurer disparaît au même clic ;
- on ne pouvait pas travailler sur ce qui attendait : les poignées de la carte étaient celles
  de la route actuelle du navire, et l'anneau qui prolonge, au bout de cette route-là.

Fait (`src/ui/awaited.js`, nouveau ; la carte, la fiche et les ordres le lisent) :

- ce qui est en route vers un navire reste tracé **en ocre** (l'ambre du thème, déjà celui
  des mises en garde), pour tous les navires ; pour celui qui est en main, plus épais, avec
  « part par radio à 16 h » au bout. La fiche dit « Tracé de n points en attente », ou liste
  les étapes telles qu'elles seront, en ocre, avec « à transmettre » ;
- l'éditeur de route travaille sur le tracé en attente : ses points, ses « + », l'anneau à
  son bout. On le prolonge une deuxième puis une troisième fois, on déplace, on ajoute, on
  retire. Chaque changement renvoie l'ordre qui attendait avec les nouveaux points : un seul
  ordre part. Retirer son dernier point reprend l'ordre ;
- les étapes en attente se modifient et se retirent depuis la liste, qui compte comme les
  ordres compteront à l'arrivée ; on en ajoute d'autres à la suite ;
- un tracé tiré depuis le navire retire de l'attente les étapes et les modifications de
  l'ancienne route, qu'il écraserait à l'arrivée ; une étape ajoutée retire le tracé (le
  navire lâche sa route pour suivre ses étapes). Un ordre confié à un groupe, remis à un
  autre moment, n'est pas touché.

**2. Deux défauts trouvés en chemin, corrigés.**

- Deux modifications de la route d'un navire avant la même relève : la seconde repartait de
  la route actuelle et remplaçait la première, qui était perdue sans un mot. Elles se
  cumulent maintenant.
- Un ordre passé tout de suite (le navire entré en eaux suivies, ou un avion en vue pour le
  projecteur) laissait en attente le même ordre envoyé plus tôt par radio : à la relève,
  l'ancien défaisait le nouveau. L'ancien est retiré.

**3. Ce que j'ai ajouté sans qu'on le demande, parce que l'attente le rend visible.**

- Un ordre par radio n'est vérifié contre la côte qu'à l'arrivée : refusé, on ne l'apprenait
  qu'à la relève. La fiche prévient maintenant tant qu'il attend, et la carte cercle l'endroit,
  si le trajet touche terre vu de la position estimée. Trouvé en essayant : mon étape au
  cap 020 depuis Terre-Neuve était listée comme acquise et refusée à la relève.
- Les étapes d'un navire dont la position est une estimation étaient dessinées depuis sa
  position vraie, à côté de son repère : elles partent maintenant du repère, comme sa route.
  La règle posée depuis un navire aussi.

**4. Le rapport de quart.** `openWatch` savait ouvrir n'importe quel rapport, mais seul
l'arrêt à la relève l'appelait. Trois entrées de plus, toutes sur la même page :

- un bouton « Quart » dans la barre du haut (la cloche ; touche Q), présent dès le premier
  rapport là où la mer vit au rythme des quarts, avec le nombre de décisions en attente ;
- dans l'onglet « Signaux », « Rouvrir le rapport de la relève de 8 h » en tête, et
  « Ouvrir » sur chaque ligne ;
- la page rouverte est celle de la relève : mêmes textes, mêmes boutons, « (réglé) » sur ce
  qui a reçu sa réponse entre-temps.

La barre du haut a onze outils dans l'Atlantique : 51 px de haut et 976 px de large sur une
fenêtre de 1 024 px, mots compris. Elle tient.

**Ce qui n'est pas fait.** En ordres par caps, la deuxième étape se mesure toujours avec la
règle, depuis le bout du tracé ocre : il n'y a pas d'anneau au bout des étapes d'où tirer la
règle. La mise en garde « touche terre » part de la position estimée : le navire juge de sa
position vraie, et peut encore refuser un trajet qu'elle ne signalait pas. La page d'un
rapport n'a pas de boutons « précédent » et « suivant ».

**La simulation.** Deux ajouts qui ne changent rien à une partie : `plannedLegs` (les étapes
qu'aurait un navire après une suite d'ordres, sans y toucher) et un point de départ
facultatif pour `planTrack`. Les règles de remplacement vivent dans la page, pas dans
`sendOrder` : le joueur automatique n'est pas concerné. Neuf parties de l'Atlantique
rejouées, identiques à la mesure du M2.10.

**Tests.** `tests/awaited.test.js`, 10 tests : le tracé qui attend, prolongé deux fois, ses
points déplacés, ajoutés, retirés, puis reçu tel que la table le montrait ; l'ordre repris ;
les deux modifications qui se cumulent ; les étapes ajoutées, modifiées, retirées, puis
reçues ; `plannedLegs` comparé aux mêmes ordres exécutés ; ce qui est remplacé ; l'ordre au
projecteur ; la terre signalée. `tests/watchpanel.test.js`, un test de plus : le rapport
rouvert par la barre, l'onglet et une ligne, identique, puis réglé.

### Porte du troisième tour

432 tests, lint et construction verts ; 272 vérifications à l'essai de fumée (12 de plus : le
rapport fermé puis rouvert de quatre façons, la barre à 1 024 px avec son onzième outil, un
tracé en attente prolongé à la souris depuis son anneau puis repris, une étape en attente),
sur la version de développement et sur `dist/index.html`. Pas de singe ni de grande mesure
pour ce tour, comme demandé : la simulation n'a pas changé. Essayé aussi à la souris sur un
groupe d'escorte en haute mer (tracé en attente, prolongé depuis l'anneau, reçu à la relève,
puis une étape). Branche `retours-jeu-3`, demande de fusion nº 8, vérifications de GitHub
vertes (commit adfc2e2, le dernier avant cette ligne). Artefact « Jeu 1940 — travaux de
Fable » mis à jour (2.10.4) ; compte rendu du projet complété. Non relu par un agent neuf.

## Retours de jeu, quatrième tour · version 2.10.5

Message de Florian du 19 novembre, 22 h 43. Une décision, une demande et une question :

- « On laisse la régle libre après les étape car je ne vais pas toujours mesurer en bout
  d'étape par exemple. Donc laisse tel quel. » Pas d'anneau au bout des étapes : rien à faire.
- « que fais le convoi une fois au bout de la route manuel ? Il faudrait comme pour nos
  escorte pouvoir donner un ordre a éxecuter après. Comme "rejoindre Embouchut Nord de
  l'Irlande" ou " Canal St Georges" Ou continuer selon cap, ou reprendre route de l'amirauté.
  (mais attention que cela match pour les autres scénario, donc le CW de Kanalkampf doit
  avoir d'autre objecif. »
- « une route manuel qui se termine dans les cercles de "Nord de l'Irlande" Canal
  saint-george ou vers le port pour le CW de Kanalkampf, est-ce qu'elle automatise la passage
  en "pilote" Si non, il faudrait comme pour les avions qui peuvent attérir ailleur, que
  l'ordre de fin puisse être "rejoindre Liverpool par St george, ou Irlande, etc, etc. »

Branche `retours-jeu-4`, partie de `retours-jeu-3` ; version 2.10.5.

### 19 novembre, 22 h 45 à 20 novembre, 0 h 30 — ce qui a été trouvé et fait

**1. La réponse à la question, lue dans le code de la 2.10.4.** Oui, mais pas comme on
pourrait le croire :

- au bout d'un tracé qui ne mène à aucun port, le convoi s'arrête et attend (« en attente
  d'ordres en mer ») ; au bout de ses étapes, il garde le cap ;
- un tracé est prolongé de lui-même jusqu'au port s'il passe à moins de 160 km de l'entrée
  d'un chenal (`convoy.gateRadiusKm`) et finit à moins de 450 km du port
  (`convoy.approachEndKm`) : il est coupé à son point le plus proche de l'entrée, relié à
  l'entrée en ligne droite, et le chenal est ajouté. Un tracé qui finit dans un cercle
  « Pilote » (40 km) remplit donc toujours la condition. Un tracé qui finit à moins de 15 km
  d'un port y entre aussi ;
- le port est celui qui est le plus près **de la fin du tracé**. L'entrée du Nord de
  l'Irlande est à 221 km de la Clyde et à 453 km de Liverpool, à vol d'oiseau : un tracé qui
  finit dans ce cercle part donc toujours pour la Clyde, jamais pour Liverpool. Par le canal
  Saint-Georges, c'est Liverpool ;
- avec des étapes au cap, ou le cap gardé, la règle est autre : une fois par minute, à moins
  de 40 km d'une entrée (`navigation.pilotKm`, le cercle dessiné), le pilote monte à bord et
  conduit le convoi au **premier port de la liste** qui a ce chenal : Liverpool pour le Nord
  de l'Irlande. Les deux règles ne choisissent donc pas le même port par le nord. Je ne les
  ai pas changées (ce serait changer ce que fait une partie sans ordre) ; la fiche dit
  maintenant lequel sera pris, et le laisse changer.

**2. L'ordre de fin d'un convoi.** `endAction` sur un convoi (`src/sim/convoy.js`), `null`
par défaut : rien ne change pour qui ne donne pas d'ordre. Les choix viennent des données du
scénario (`convoyEndChoices`) : s'arrêter et attendre, garder le cap, chaque port qui reçoit
ce convoi par chacun de ses chenaux, la route de l'Amirauté. Un convoi de l'océan : Liverpool
par le Nord de l'Irlande ou par le canal Saint-Georges, la Clyde par le Nord de l'Irlande. Le
CW 7 de Kanalkampf : Southampton par Spithead. Aucun port étranger.

- Avec un ordre, le convoi suit son tracé ou ses étapes **jusqu'au bout**, puis l'exécute ;
  d'ici là le jeu ne le prend plus de lui-même : ni prolongement du tracé, ni pilote en
  passant dans un cercle.
- Un tracé que le jeu avait prolongé jusqu'à un port (ou la route de l'Amirauté) et à qui
  l'on donne une autre fin perd ce que le jeu avait ajouté : le tracé reste, tel qu'il est
  au joueur, et finit comme dit. Choisir le port et le chenal qu'il prenait déjà ne change
  rien. Dans le chenal, pilote à bord, il est trop tard.
- Donné une fois : exécuté, l'ordre est oublié. Il part avec ce dont il était la fin (étapes
  effacées, tracé tiré jusque dans un port). Sans rien à suivre (arrêté en mer, ou cap
  gardé), le convoi l'exécute tout de suite.
- « Entrer à… » : par la mer jusqu'à l'entrée du chenal choisi, puis le chenal
  (`channelWay`). « Reprendre la route de l'Amirauté » : au prochain point devant le convoi,
  en contournant la terre s'il le faut (`admiraltyWay`).
- Un traînard reçoit l'ordre de son convoi. Deux champs de plus dans une sauvegarde, lus
  avec leur valeur par défaut : le format reste le 2.

**3. La fiche et la carte.** J'avais d'abord écrit la liste pour les seuls tracés qui
finissent en mer, avec une simple phrase pour ceux que le jeu prolonge. En l'essayant j'ai
vu que cela laissait le cas que décrit Florian sans réponse : un tracé tiré jusqu'au cercle
du Nord de l'Irlande partait pour la Clyde, et rien ne permettait de dire Liverpool. La liste
est donc toujours là dès qu'il y a un tracé ou des étapes, et **montre d'abord ce que le
convoi fait de lui-même** (« Entrer à la Clyde par : Nord de l'Irlande », « S'arrêter et
attendre », « Garder le cap ») ; on en choisit un autre. Sans rien à suivre, elle s'appelle
« Et maintenant ». Sur la carte, pour le convoi en main : un mot au bout du tracé et, en
pointillé, le chemin qu'il prendra ensuite.

**4. Sous silence radio.** L'ordre de fin part à la relève, en ocre jusque-là. Les ordres
d'une relève sont lus l'un après l'autre : selon que le tracé ou l'ordre de fin avait été
envoyé le premier, le résultat différait (le tracé prolongé par le jeu puis rendu au joueur à
l'endroit de la coupe, ou suivi en entier ; pire, l'ordre de fin exécuté sur place avant
l'arrivée du tracé). Deux règles, dans `src/sim/comms.js` : l'ordre de fin d'un navire est
toujours lu après ses routes, et ce qu'un convoi doit faire au bout est noté avant la lecture
de ses routes. Dans les deux sens d'envoi, le convoi suit le tracé tel qu'il est dessiné,
puis fait ce qui est dit.

**5. Le B-Dienst.** Le chemin que prend le convoi au bout de son tracé est un nouveau
routage. Je l'avais d'abord marqué comme illisible pour le B-Dienst (« il le fait de
lui-même »). C'était une faille : un tracé de dix kilomètres suivi de « Entrer à… » aurait
donné toute la traversée sans que l'ennemi puisse la lire. Il se lit donc comme un autre,
sauf si l'ordre est venu par projecteur ou porté par un groupe, comme pour une route.

**6. Trois défauts trouvés en chemin.**

- **Les tracés du convoi côtier refusés pour une côte qu'ils ne touchaient pas.** Depuis son
  mouillage de l'estuaire de la Tamise, l'entrée de Spithead est à 156 km à vol d'oiseau :
  moins que les 160 km de la règle. Tout tracé du CW 7 qui s'arrêtait avant d'avoir doublé
  Beachy Head était donc coupé à son point le plus proche de Spithead (souvent le convoi
  lui-même) et envoyé en ligne droite par-dessus le Kent et le Sussex, puis refusé :
  « route refusée, elle coupe la côte ». Essayé le long de la route de l'Amirauté elle-même :
  refusé avec 2, 3 et 4 points, accepté à partir du sixième. Le jeu ne prolonge plus un tracé
  que si le trajet jusqu'à l'entrée passe par la mer ; sinon le tracé reste comme il est
  dessiné. Le trajet est regardé avec le même pas que la route entière : toute route acceptée
  avant l'est encore, à l'identique.
- **L'entrée gagnée par la mauvaise mer.** Sur la capture de mon premier essai, le convoi à
  qui l'on disait « Liverpool par le canal Saint-Georges » depuis l'entrée du nord descendait
  la mer d'Irlande jusqu'à l'entrée du sud, pour la remonter ensuite : le plus court chemin
  par la mer jusqu'à cette entrée passe derrière elle. Il gagne maintenant l'entrée par le
  large, sans traverser les eaux qu'elle ferme (celles qui sont fermées aux U-Boote,
  `uboatnav.js`) : il contourne l'Irlande par l'ouest. Déjà dans ces eaux, il rejoint le
  chenal là où il est.
- **Le traînard sans ordre.** `completeEntity` remet les champs déclarés à leur valeur de
  départ : l'ordre copié du convoi était effacé à la naissance du traînard. Trouvé par le
  test écrit pour ce cas.

Le singe en a trouvé un quatrième, hors de l'interface : l'ordre « rentrer au port » des
groupes, donné par signal à un convoi, laissait son ordre de fin sur une route qui entre au
port. Il est retiré avec.

**Ce qui n'est pas fait.** Le port que le jeu choisit de lui-même par le Nord de l'Irlande
reste la Clyde pour un tracé et Liverpool pour des étapes. Les groupes d'escorte gardent
leur ordre de fin (un port, sans choix du chenal). Le bouton « Amirauté » de la barre refuse
toujours une ligne droite qui coupe la terre, là où l'ordre de fin la contourne. Sous
silence radio, le chemin dessiné part du bout du tracé ; le convoi le calculera de sa
position vraie.

**Tests.** `tests/convoyend.test.js`, 24 tests : sans ordre, rien ne change (arrêt au bout
d'un tracé, cap gardé après les étapes) ; les choix de chaque scénario et ce qui est refusé ;
garder le cap, donné une fois ; Liverpool par le canal Saint-Georges jusqu'à l'arrivée, à
l'heure annoncée à une heure près ; Liverpool ou la Clyde par le nord ; la route de
l'Amirauté, tout droit puis en contournant la terre ; l'arrêt au bout des étapes ; l'ordre
exécuté tout de suite ; l'ordre retiré avec les étapes effacées, le tracé tiré jusqu'au
port, le « rentrer au port » ; le tracé prolongé rendu au joueur ; ni prolongement ni pilote
tant qu'un ordre attend, et trop tard dans le chenal ; l'entrée gagnée par le large ;
l'attente quand il n'y a pas de passage ; le traînard ; la sauvegarde ; une vraie partie de
la 2.9.0 ; par radio dans les deux sens d'envoi ; un convoi arrêté ; le B-Dienst ; la fiche,
sous silence radio aussi ; le journal ; les tracés du convoi côtier ; Southampton par
Spithead. `tests/messages.test.js` : un exemple pour la nouvelle phrase. Le singe donne
l'ordre de fin d'un convoi (direct et par signal) et vérifie chaque heure de jeu qu'un convoi
en route vers un port n'en a pas : pour m'assurer qu'il voit bien la faute, j'ai retiré la
ligne qui l'efface, et il l'a signalée cinq fois en 3 000 ordres de Kanalkampf.

### Porte du quatrième tour

456 tests (24 de plus), lint et construction verts ; 289 vérifications à l'essai de fumée
(17 de plus), sur la version de développement et sur `dist/index.html` : la liste de la
fiche sur un convoi en haute mer, l'ordre de fin par radio en attente puis reçu à la relève,
l'ordre donné tout de suite sur un tracé qui finit en pleine mer et exécuté au bout du tracé,
le convoi côtier de Kanalkampf (son tracé accepté devant Douvres, son seul port, sa route par
Spithead). Captures regardées : la fiche, le chemin en pointillé, le journal.

La simulation change cette fois. Le singe : 10 000 ordres par scénario sur les cinq, puis
quatre autres graines (Atlantique, Kanalkampf, M0, Adlertag), sans faute. Le joueur
automatique ne donne jamais d'ordre de fin à un convoi : j'ai rejoué une partie de chacune
des 34 lignes de la mesure (graine 1). 33 sont identiques à leur référence du M2.10 ; la
34e, la campagne en Réaliste à conduite simple, est celle de la mesure faite après la 2.10.2
(victoire ; c'était une défaite avant que la 2.10.2 ne change le compte des avions à abattre
en campagne). Ce tour ne change donc aucune partie jouée sans ordre de fin.

Branche `retours-jeu-4`, demande de fusion nº 9, vérifications de GitHub vertes (commit
8ec5aeb, le dernier avant cette ligne). Artefact « Jeu 1940 — travaux de Fable » mis à jour
(2.10.5) ; compte rendu du projet complété. Non relu par un agent neuf.

**20 novembre, 0 h 45 — une ligne de journal de plus.** En regardant à l'écran le cas que
décrit Florian (un tracé tiré jusqu'au cercle du Nord de l'Irlande, puis Liverpool choisi
dans la liste), le journal du jeu disait encore « route acceptée vers la Clyde ». Quand un
ordre de fin rend au joueur un tracé que le jeu prolongeait, le journal dit maintenant ce en
quoi le tracé finit (« route acceptée. En fin de tracé : « Entrer à Liverpool par : Nord de
l'Irlande » »). Les 456 tests, l'essai de fumée complet (289) et le singe (10 000 ordres par
scénario) repassés ; artefact republié.
