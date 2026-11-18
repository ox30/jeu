# Joueur automatique

Un joueur qui lit ce que la table montre et donne les ordres d'un joueur. Il sert à mesurer
l'équilibre du jeu avant et après chaque lot, sur plusieurs graines, et à chercher les
plantages avec des ordres au hasard.

Il vient de l'audit du prototype 2.6.1 et a été versé au dépôt au lot M2.7.

## Ce qu'il sait et ce qu'il ne sait pas

- Il ne lit que ce que le joueur voit : les plots et leur estimation (`query.contactEstimate`),
  les repères de U-Boote, ses propres unités, les questions posées. Jamais les raids ni les
  U-Boote eux-mêmes.
- Il ne donne que des ordres (`src/sim/orders.js` et les modules d'ordres : engagement,
  convois, formations, effectifs).
- Il réagit dans la minute et calcule ses interceptions sans erreur. Il mesure donc
  l'équilibre et les choix dominés, **pas la difficulté ressentie** par un joueur.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `game.mjs` | charge les données, crée un monde, compte les arrêts, chronomètre les pas |
| `air.mjs` | les batailles aériennes (`runAir`) et la campagne enchaînée (`runChain`) |
| `sea.mjs` | l'Atlantique (`runSea`) |
| `conducts.mjs` | les conduites (façons de jouer) et la matrice de mesure |
| `run.mjs` | une partie, résultat en une ligne de JSON |
| `measure.mjs` | la matrice sur plusieurs graines, tableau Markdown |
| `perf.mjs` | durée des pas de simulation, une partie à la fois |
| `monkey.mjs` | ordres au hasard, avec sauvegardes et reprises |

## Conduites

Batailles aériennes : `rien` (aucun ordre), `simple` (deux escadrilles par raid, davantage
contre un gros), `soigne` (en plus : chasses libres laissées, repos la nuit), `sans-chasse`,
`sans-ravitaillement`, `1-par-raid` à `6-par-raid`, `masse` (six par raid, poursuite permise
au-delà de la mi-Manche), `masse-le-15` (campagne jouée simplement, le 15 septembre en masse).

Atlantique : `rien`, `simple` (un groupe d'escorte par convoi), `rester`, `chasser`, `soigne`
(chasser, avec couverture aérienne), `deux-avions` (Hudson et Catalina achetés le premier jour).

Une conduite peut aussi se donner en JSON :

```
node tools/bot/run.mjs adlertag '{"perRaid":3,"ignoreHigh":true,"preset":"realistic","seed":4}'
```

## Mesurer

```
node tools/bot/measure.mjs --name avant --seeds 10 --workers 2
node tools/bot/measure.mjs --name apres --seeds 10 --only hiver,campagne/realistic
node tools/bot/measure.mjs --summary avant
```

Les résultats vont dans `tools/bot/out/<nom>.jsonl` (une ligne par partie, non versé au
dépôt). La matrice complète, 32 lignes sur dix graines, prend environ quarante minutes sur
deux cœurs.

Les durées de pas d'une mesure à deux parties de front ne valent rien : pour les pas, lancer
`node tools/bot/perf.mjs` seul, sur une machine au repos.

## Ordres au hasard

```
node tools/bot/monkey.mjs adlertag 10000 1 standard    # scénario, ordres, graine, préréglage
npm run fuzz                                           # 10 000 ordres par scénario
```

Chaque ordre de l'interface est tiré au hasard, avec des arguments au hasard. Toutes les
heures de jeu, le monde est contrôlé (positions, effectifs, stocks) ; de temps en temps il est
sauvegardé puis repris, et la partie reprise doit être la partie sauvegardée.
