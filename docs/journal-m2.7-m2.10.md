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

### 18 novembre, 18 h 25 à 19 h 40 — quarts (I2, A, N10), silence radio (N1), radars (N4)

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
