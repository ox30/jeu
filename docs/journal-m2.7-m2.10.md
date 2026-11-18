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
