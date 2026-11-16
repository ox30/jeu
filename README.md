# Prototype M1 — Kanalkampf, juillet 1940

Prototype du jeu navigateur sur la Seconde Guerre mondiale : le joueur commande le soutien
allié (aviation, escortes, logistique), jamais les armées. Le M1 est une tranche de l'Âge I :
quinze jours de juillet 1940, deux convois HX à faire traverser l'Atlantique malgré les
U-Boote, un convoi côtier dans la Manche, le carburant et le matériel à répartir par le rail,
et la chasse à faire décoller contre les raids.

Le cahier des charges complet se trouve dans le projet claude.ai « Jeu navigateur seconde
guerre mondiale ».

## Lancer le jeu

Le jeu se joue sur un ordinateur, avec une souris et un clavier.

1. **Sans rien installer** : ouvrir `dist/index.html` dans le navigateur (double-clic). Ce
   fichier contient tout le jeu ; il est régénéré par `tools/build-page.mjs`.
2. **Version de développement** (modules séparés) : servir le dossier avec un petit serveur
   web, puis ouvrir http://localhost:8000.

   ```
   python3 -m http.server 8000
   ```

   Ouvrir `index.html` directement depuis le disque ne marche pas pour cette version : les
   navigateurs refusent les modules JavaScript chargés depuis `file://`.

Pour GitHub Pages, il suffit de publier la racine du dépôt : `index.html` est la page
d'entrée.

Le bouton « Scénario » permet de choisir entre **Kanalkampf** (M1) et **Entraînement**
(le scénario du M0, sans logistique).

## Comment jouer à Kanalkampf

Trois cartes : Atlantique (touche A), Grande-Bretagne (L) et Angleterre (G).

1. **Convois.** HX 55 et HX 57 sont en mer. Tracez leur route, ou cliquez sur « Route de
   l'Amirauté », jusqu'au chenal du nord de l'Irlande ou au canal Saint-Georges : un pilote
   les conduit ensuite à Liverpool ou à la Clyde. Les cercles hachurés sont des U-Boote
   probables, repérés par radiogoniométrie. Les U-Boote attaquent de nuit ; un groupe
   d'escorte réduit les pertes (« Rejoindre » dans sa fiche, ou des étapes en Réaliste).
2. **Convoi côtier.** CW 7 attend dans l'estuaire de la Tamise avec du matériel pour
   Southampton. De jour, dans la Manche, la Luftwaffe l'attaque : faites-le appareiller au bon
   moment et couvrez-le avec une escadrille (« Couvrir CW 7 »).
3. **Logistique.** Les convois déchargent carburant et matériel dans les ports. Depuis la
   fiche d'un port, envoyez des trains vers les bases (carburant) et les usines (matériel) ;
   chaque ligne ne prend qu'un nombre limité de trains par jour. Dans la fiche d'une base ou
   d'une usine, un stock minimum fait partir les trains tout seuls. Une escadrille ne refait
   pas le plein sur une base sans carburant. Les usines transforment le matériel en avions,
   livrés aux escadrilles qui en ont perdu.
4. **Défense aérienne.** À l'alerte, glissez depuis un aérodrome vers le raid (ou donnez un cap
   et des étapes), réglez l'altitude par pas de 1 000 ft (↑ ↓) pour arriver au-dessus. Les
   tiges montrent l'altitude de chaque formation ; la plaque du raid donne l'écart avec
   l'escadrille choisie, et la vue de profil de sa fiche dit si la montée sera finie à temps.
   Un raid manqué laisse un trait pointillé avec l'écart ; chaque combat finit par un rapport.
5. **Installations.** Aérodromes, radars, ports et usines peuvent être bombardés : un radar
   hors service ouvre un trou dans la couverture, un aérodrome endommagé fait décoller plus
   lentement et détruit les avions restés au sol, les bombes détruisent une partie des stocks.

Victoire le 24 juillet si les convois livrent l'essentiel de leur cargaison, si au moins 4 des
5 bases de chasse sont en service et si la chasse garde 60 % de ses avions. Défaite immédiate
si toutes les bases restent 24 heures sans carburant. Ces seuils sont provisoires.

Raccourcis : Espace pause · 1 à 6 vitesse · A Atlantique · L Grande-Bretagne · G Angleterre ·
R règle · Entrée ajouter l'étape mesurée · C couverture radar · Échap annuler ·
↑ ↓ altitude · S décoller · B pleine vitesse · O orbite · P rentrer.

## Ordres au cap et étapes

Avions, convois et groupes d'escorte peuvent recevoir une liste d'étapes : un cap jusqu'à une
fin. La fin se tape librement : une durée (`6`, `1 h 30`, `30 h`), une heure (`14:20`), un
carré de la grille de l'Angleterre (`J5`) ou une position (`56N 12O`, `50.5N 1.5E`). La règle
(touche R, ou glisser depuis une unité en réglage Réaliste) affiche le cap, la distance et le
temps de trajet de l'unité choisie ; Entrée ajoute l'étape mesurée. Une étape qui manque son
objectif s'arrête au plus près et l'étape suivante part de là, comme une navigation à l'estime.

## Réglages

Trois préréglages, modifiables un par un dans « Réglages » :

| Réglage | Arcade | Standard | Réaliste |
| --- | --- | --- | --- |
| Détection | raids exacts | effectif et altitude approximatifs | plots en retard |
| Fausses alertes | non | non | oui |
| Aide à l'interception | point d'interception | trajectoire prolongée | aucune (règle) |
| Carburant des avions | illimité | autonomie simple | seuil de retour et déroutement |
| Ordres | route tracée | route tracée | caps et étapes |
| Logistique | répartition automatique | manuelle | manuelle |

Options : tiges d'altitude, grille de carrés, zoom automatique et ralenti à l'alerte, sons.

## Organisation du code

```
/
├── README.md
├── index.html, style.css      page et styles
├── src/
│   ├── main.js                démarrage et boucle de jeu
│   ├── core/                  temps, aléatoire à graine, traductions, chargement des données
│   ├── sim/                   simulation (aucun accès à la page) : convois et navires,
│   │                          escadrilles, raids, détection, combat, navigation par étapes,
│   │                          installations, logistique, U-Boote et escortes, objectifs
│   ├── render/                caméra, carte, symboles, animations, vue de profil
│   ├── ui/                    souris, clavier, panneaux, sons, alertes, dialogues
│   └── save/                  réglages gardés dans le navigateur
├── data/
│   ├── maps/                  côtes Natural Earth projetées, noms de lieux
│   ├── scenarios/             kanalkampf.json (M1), m0-july-1940.json (entraînement)
│   ├── rules.json             équilibrage (avions, combat, détection, logistique, U-Boote)
│   ├── presets.json           préréglages Arcade, Standard, Réaliste
│   └── i18n/fr.json           tous les textes affichés
├── tests/                     tests de la simulation (Node)
├── tools/                     génération des cartes et de la version en un seul fichier
└── dist/index.html            le jeu en un seul fichier
```

Le code est en anglais, les textes du jeu sont tous dans `data/i18n/fr.json` : ajouter une
langue revient à traduire ce fichier. Les scénarios, l'équilibrage et le réseau ferré sont
dans des fichiers JSON : on peut les modifier sans toucher au code.

La simulation avance par pas d'une seconde de temps de jeu et utilise un générateur aléatoire
à graine : une même partie se rejoue à l'identique, ce qui facilite les tests et
l'équilibrage.

## Tests

```
npm test
```

Les tests (Node 20 ou plus récent, sans dépendance) vérifient notamment la géométrie, la
terre et la mer, les routes et les étapes, le pilote à l'entrée des chenaux, les
interceptions et les ratés, les rapports de combat, les dégâts et réparations des
installations, les trains et leurs sillons, le plein des escadrilles, la production
d'avions, les U-Boote et les escortes, les raids contre le convoi côtier, la défaite faute de
carburant et une quinzaine complète sans ordres.

## Outils

```
cd tools
npm install
node build-maps.mjs    # régénère data/maps/atlantic.json et channel.json
node build-page.mjs    # régénère dist/index.html
```

## Données et sources

- Côtes : Natural Earth 1:50m et 1:10m (domaine public), via le paquet world-atlas.
- Positions des aérodromes, radars, ports, usines et lignes de chemin de fer, effectifs,
  stocks et performances : valeurs approximatives choisies pour le jeu, à vérifier avec les
  sources de référence du projet. Les noms de convois sont inspirés de l'époque.

## Limites connues du M1

- Pas de sauvegarde de partie (seuls les réglages sont gardés).
- Pas de fatigue des pilotes ni d'état d'alerte au sol ; pas de météo.
- Réparations automatiques et gratuites ; les trains ne peuvent pas être bombardés.
- Combat, logistique et U-Boote sont abstraits ; l'équilibrage et les seuils de victoire sont
  provisoires, à régler en jouant.
- Conçu pour un ordinateur : sur téléphone, un avertissement s'affiche et l'écran est serré.
