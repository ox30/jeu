# Prototype M2 — Acte I, 1940-1941

Prototype du jeu navigateur sur la Seconde Guerre mondiale : le joueur commande le soutien
allié (aviation, escortes, logistique), jamais les armées. Le M2 réunit l'Âge I en une
campagne de quatre scénarios, de la bataille de la Manche à l'hiver 1941 dans l'Atlantique,
avec un tutoriel guidé.

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

## Scénarios et campagne

Le bouton « Scénario » ouvre la campagne de l'acte I. Une victoire ouvre le scénario suivant ;
la case « Débloquer tous les scénarios » les ouvre tous d'un coup.

| Scénario | Période | L'essentiel |
| --- | --- | --- |
| Kanalkampf | 10-24 juillet 1940 | deux convois HX, un convoi côtier dans la Manche, le rail, les premiers raids |
| Adlertag | 12-18 août 1940 | raids sur les radars et les aérodromes, chasses libres, station radar mobile, relève |
| 15 septembre | une journée | deux grandes vagues sur les docks de Londres, Big Wing de Duxford |
| Hiver dans l'Atlantique | 10 janvier - 31 mars 1941 | convois réguliers HX et SC, meutes de U-Boote, dollars, prêt-bail |
| Entraînement | juillet 1940 | un convoi, quelques raids, et le **tutoriel guidé** |

Entre les batailles aériennes, le réglage « Campagne » reporte une partie des pertes : en
Standard, la chasse commence la bataille suivante avec la moitié des avions perdus en moins
(au moins 75 %) ; en Réaliste, avec toutes les pertes (au moins 60 %). Les usines et les
convoyeurs comblent ensuite les vides.

La partie en cours est enregistrée toute seule dans le navigateur et reprend où on l'a
laissée. Le menu « Scénario » permet aussi de l'exporter dans un fichier `.json` et de la
réimporter.

## Comment jouer

Trois cartes : Atlantique (touche A), Grande-Bretagne (L) et Angleterre (G). L'aide (?)
donne les étapes propres au scénario en cours.

1. **Convois.** Tracez leur route, ou cliquez sur « Route de l'Amirauté », jusqu'au chenal du
   nord de l'Irlande ou au canal Saint-Georges : un pilote les conduit au port. La vitesse
   ordonnée garde le convoi groupé ; plus près de sa vitesse maximale, des navires lents
   décrochent et deviennent des traînards. Le zigzag gêne les U-Boote mais ralentit.
2. **U-Boote.** Ils attaquent de nuit, en surface. Les zones hachurées viennent de la
   radiogoniométrie ; un repère U-Boot (vu par une vigie, un avion, l'ASDIC ou le radar)
   porte deux cercles : où il peut être en surface, et en plongée. Un groupe d'escorte
   « Rejoint » un convoi et, au choix, « Reste » avec lui ou « Chasse » un contact frais.
3. **Patrouilles.** La section de guet (Spitfire) et le Coastal Command voient ce que les
   radars voient mal : un raid en vue d'une patrouille est connu exactement. Une patrouille
   peut être surprise par l'escorte allemande.
4. **Défense aérienne.** À l'alerte, glissez depuis un aérodrome vers le raid, réglez
   l'altitude (↑ ↓, par 1 000 ft) pour arriver au-dessus. En Arcade, « Intercepter » laisse
   le contrôleur guider l'escadrille ; sa chance dépend de la couverture radar à l'endroit de
   la rencontre. Les raids très hauts sans bombardiers sont des chasses libres. Plusieurs
   escadrilles sur le même raid se partagent la pression de l'escorte ; en « Big Wing », une
   escadrille vole avec un chef (« Voler avec… » dans sa fiche).
5. **Tracés.** Cliquez une unité pour voir les carrés de sa route : glissez-les, ajoutez-en
   avec « + », prolongez par l'anneau du bout, double-cliquez pour retirer ; un point choisi
   prend une altitude (↑ ↓). En fin de tracé, l'escadrille orbite, sauf autre choix dans sa
   fiche (se poser, rentrer, couvrir un convoi). Maj + glisser mesure avec la règle.
6. **Pilotes.** La fatigue monte en vol et en combat, baisse au sol. L'état d'alerte règle le
   délai de décollage : au repos (pas de décollage, récupération), disponible (5 min), en
   cockpit (2 min, fatigue). En Réaliste, des pilotes sont tués et remplacés lentement.
7. **Logistique.** Les convois déchargent carburant et matériel dans les ports ; le dépôt de
   Chilmark fournit les munitions. Envoyez des trains (jusqu'à 100 t, chargement mélangé) ou
   fixez des stocks minimum : les trains partent seuls. Sans carburant, une escadrille ne
   refait pas le plein ; sans munitions, elle repart à moitié armée, ou pas du tout. Les
   usines transforment le matériel en avions.
8. **Installations.** Aérodromes, radars, ports et usines peuvent être bombardés. Un radar
   hors service ouvre un trou dans la couverture ; à partir d'Adlertag, une station radar
   mobile peut le boucher (onglet Installations, « Déployer »).
9. **Dollars (hiver 1941).** Avant le prêt-bail, la cargaison des convois se paie comptant :
   l'onglet Logistique règle la part achetée de chaque convoi, ou commande des Hudson et des
   Catalina en Amérique.

Chaque raid se termine par un rapport, rangé dans « Rapports » ; les « Fiches » donnent les
performances des avions et des navires. Les pages mettent le jeu en pause (réglable).

Raccourcis : Espace pause · 1 à 6 vitesse · A Atlantique · L Grande-Bretagne · G Angleterre ·
R ou Maj + glisser règle · Entrée ajouter l'étape mesurée · C couverture radar · Échap
annuler · ↑ ↓ altitude · Suppr retirer le point choisi · S décoller · B pleine vitesse ·
O orbite · P rentrer.

## Ordres au cap et étapes

Avions, convois et groupes d'escorte peuvent recevoir une liste d'étapes : un cap jusqu'à une
fin. La fin se tape librement : une durée (`6`, `1 h 30`, `30 h`), une heure (`14:20`), un
carré de la grille de l'Angleterre (`J5`) ou une position (`56N 12O`, `50.5N 1.5E`). La règle
affiche le cap, la distance et le temps de trajet de l'unité choisie ; Entrée ajoute l'étape
mesurée. Une étape déjà posée se corrige avec ✎.

## Réglages

Trois préréglages, modifiables un par un dans « Réglages » :

| Réglage | Arcade | Standard | Réaliste |
| --- | --- | --- | --- |
| Détection | raids exacts | effectif et altitude approximatifs | plots en retard |
| Fausses alertes | non | non | oui |
| Aide à l'interception | guidage automatique | trajectoire prolongée | aucune (règle) |
| Carburant des avions | illimité | autonomie simple | seuil de retour et déroutement |
| Ordres | route tracée | route tracée | caps et étapes |
| Logistique | répartition automatique | manuelle | manuelle |
| Fatigue des pilotes | non | oui | oui, avec pilotes tués |
| Campagne : pertes reportées | aucune | la moitié | toutes |

Options : tiges d'altitude, grille de carrés, zoom automatique et ralenti à l'alerte, sons,
pause pendant les pages.

## Organisation du code

```
/
├── README.md
├── index.html, style.css      page et styles
├── src/
│   ├── main.js                démarrage et boucle de jeu
│   ├── core/                  temps, aléatoire à graine, traductions, chargement des données
│   ├── sim/                   simulation (aucun accès à la page) : convois et navires,
│   │                          escadrilles, raids, détection, guidage, combat, patrouilles,
│   │                          lutte anti-sous-marine, pilotes, installations, logistique,
│   │                          radars mobiles, événements datés, convois réguliers et dollars,
│   │                          rapports, objectifs
│   ├── render/                caméra, carte, symboles, animations, vue de profil
│   ├── ui/                    souris, clavier, panneaux, pages, campagne, tutoriel, sons
│   └── save/                  réglages et parties gardés dans le navigateur
├── data/
│   ├── maps/                  côtes Natural Earth projetées, noms de lieux
│   ├── scenarios/             kanalkampf, adlertag, quinze-septembre, hiver-atlantique,
│   │                          m0-july-1940 (entraînement)
│   ├── rules.json             équilibrage (avions, combat, détection, logistique, U-Boote)
│   ├── presets.json           préréglages Arcade, Standard, Réaliste
│   └── i18n/fr.json           tous les textes affichés
├── tests/                     tests de la simulation (Node)
├── tools/                     génération des cartes et de la version en un seul fichier
└── dist/index.html            le jeu en un seul fichier
```

Le code est en anglais, les textes du jeu sont tous dans `data/i18n/fr.json` : ajouter une
langue revient à traduire ce fichier. Les scénarios, l'équilibrage, le réseau ferré et les
événements datés sont dans des fichiers JSON : on peut les modifier sans toucher au code.

La simulation avance par pas d'une seconde de temps de jeu et utilise un générateur aléatoire
à graine : une même partie se rejoue à l'identique, y compris après une sauvegarde, ce qui
facilite les tests et l'équilibrage.

## Tests

```
npm test
```

Les 69 tests (Node 20 ou plus récent, sans dépendance) vérifient notamment la géométrie, la
terre et la mer, les routes, les étapes et leur édition, le pilote à l'entrée des chenaux,
les interceptions, le guidage du contrôleur et les ratés, les rapports, les installations,
les trains mélangés, les munitions, la fatigue et les pilotes, les patrouilles, les U-Boote
(repères, plongée, chasse, traînards, retour de patrouille), la sauvegarde et la reprise à
l'identique, les nouveaux scénarios, les achats en dollars, la campagne et une quinzaine
complète sans ordres.

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
  stocks, dates des raids et performances : valeurs approximatives choisies pour le jeu, à
  vérifier avec les sources de référence du projet. Les noms de convois et d'escadrilles
  sont inspirés de l'époque.
- Libertés assumées : la section de guet (le 421 Flight date du 21 septembre 1940) est déjà
  là en juillet ; les Catalina du 240 Squadron arrivent un peu tôt ; les heures de jour et
  de nuit sont simplifiées (été, hiver).

## Limites connues du M2

- Pas de météo ; les réparations sont automatiques et les trains ne peuvent pas être
  bombardés.
- Combat, logistique et U-Boote restent abstraits ; l'équilibrage des nouveaux scénarios a
  été réglé avec des parties automatiques, il reste à l'éprouver en jouant.
- Dunkerque attend une étape suivante.
- Conçu pour un ordinateur : sur téléphone, un avertissement s'affiche et l'écran est serré.
