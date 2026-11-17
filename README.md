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

**La fiche d'une unité** s'ouvre à droite de la carte, à côté de la colonne (Objectifs,
Tableau d'état, Journal), quand on clique une unité ou une installation. Elle tient en
onglets courts : **Ordres** (ce que l'unité doit faire : décoller, missions, état d'alerte,
attitude face à l'ennemi, formation, départs programmés), **Navigation** (comment elle y va :
route, étapes, cap, altitude, vitesse, fin de route, profil de montée), **État** et **Fiche
technique** ; une formation a aussi **Rassemblement** et **Membres**, un aérodrome
**Effectifs**. Tant qu'elle est ouverte, tout
s'adresse à cette unité : la règle, Entrée pour ajouter l'étape mesurée, ↑ ↓ pour l'altitude.
Un clic sur une autre unité change de fiche ; un clic sur la carte ne ferme plus rien ; la
croix (ou Échap) ferme la fiche et la sélection. Le bouton ⌖ centre la carte sur l'unité.

1. **Convois.** Tracez leur route, ou cliquez sur « Route de l'Amirauté », jusqu'au chenal du
   nord de l'Irlande ou au canal Saint-Georges : un pilote les conduit au port. La vitesse
   ordonnée garde le convoi groupé ; plus près de sa vitesse maximale, des navires lents
   décrochent et deviennent des traînards. Le zigzag gêne les U-Boote mais ralentit.
2. **U-Boote.** Ils attaquent de nuit, en surface. Les zones hachurées viennent de la
   radiogoniométrie ; un repère U-Boot (vu par une vigie, un avion, l'ASDIC ou le radar)
   porte deux cercles : où il peut être en surface, et en plongée. Un groupe d'escorte
   « Rejoint » un convoi et, « Face aux U-Boote », « Reste » avec lui (il n'attaque que ce
   qui s'approche, 30 min et 15 km au plus) ou « Chasse » un contact frais pendant la durée
   choisie (3 h par défaut, de 1 à 12 h) ; « Interrompre la chasse » ou tout autre ordre
   l'arrête, et un repère frais à moins de 80 km peut être chassé d'un clic. Un U-Boot tenu
   (ASDIC, ou vu tout près) reçoit une passe de grenades toutes les 10 minutes : coulé,
   touché (il rentre), perdu ou rien de visible ; chaque attaque a son rapport. « Rentrer au
   port » laisse choisir le port, du plus proche par mer au plus loin, avec distance et
   durée ; les routes de mer contournent la terre, et un tracé qui finit dans la bulle d'un
   port (15 km, montrée quand un navire est choisi) y entre. Comme pour les avions, l'onglet
   Navigation dit que faire en fin de tracé : s'arrêter et attendre, garder le cap, chasser
   sur place, rejoindre un convoi ou entrer au port. Un groupe qui attend ses ordres garde
   la veille ; un groupe attaqué en rentrant reprend ensuite sa route vers le port.
3. **Patrouilles.** La section de guet (Spitfire) et le Coastal Command voient ce que les
   radars voient mal : un raid en vue d'une patrouille est connu exactement. Une patrouille
   peut être surprise par l'escorte allemande.
4. **Défense aérienne.** À l'alerte, glissez depuis un aérodrome vers le raid, réglez
   l'altitude (↑ ↓, par 1 000 ft) pour arriver au-dessus. En Arcade, « Intercepter » laisse
   le contrôleur guider l'escadrille ; sa chance dépend de la couverture radar à l'endroit de
   la rencontre. Les raids très hauts sans bombardiers sont des chasses libres. Plusieurs
   escadrilles sur le même raid se partagent la pression de l'escorte.
   **Contact direct** : quand une escadrille, une patrouille, un convoi ou une installation
   voit le raid, il est montré en direct, à sa vraie position et avec sa composition exacte
   (« en vue · 19 Sqn »), jusqu'à la perte du visuel ; il redevient alors une suite de plots.
   De même, un U-Boot vu par une escorte (vigie ou ASDIC) ou par un avion est suivi en direct ;
   perdu, il laisse un repère à sa dernière position, d'où partent ses cercles. Les
   observateurs (Observer Corps) restent des plots.
   **Face à l'ennemi** (onglet Ordres d'une escadrille ou d'une big wing) : en *Défense*,
   l'unité n'attaque pas d'elle-même (sauf un raid sur le convoi qu'elle couvre) et demande
   l'autorisation d'engager quand elle voit un raid ; en *Attaque* (le défaut, comme au M2.2),
   elle attaque les raids qui arrivent et demande avant de poursuivre un raid qui rentre ; en
   *Attaque et poursuite*, elle poursuit sans demander jusqu'à mi-Manche, puis demande
   l'autorisation d'aller au-delà. Une question s'affiche au-dessus de la carte, passe le jeu à ×1 et l'y
   laisse après la réponse ; sans réponse en 60 s de jeu, c'est non. Il n'y a qu'une question
   par raid et par escadrille (une seule pour une big wing), et on peut couper les questions
   dans « Réglages » (l'unité applique alors son attitude sans demander). Un tracé qui finit
   sur le raid, ou « Intercepter », vaut autorisation. **« Désengager H05 »** (onglet Ordres,
   ou touche D) sort l'unité — toute la big wing — du combat, de la poursuite ou du guidage :
   elle tourne sur place en attendant les ordres et laisse ce raid tranquille, quelle que soit
   son attitude, jusqu'à un nouvel ordre sur lui (un tracé qui finit dessus, « Intercepter »).
   Passer à une attitude plus prudente retire les autorisations déjà données : une escadrille
   qui poursuivait avec votre accord et que vous passez en Défense rompt au round suivant, sans
   reposer la question. Les groupes d'escorte gardent leur règle « Rester » ou « Chasser »,
   sans question.
5. **Tracés.** Cliquez une unité pour voir les carrés de sa route : glissez-les, ajoutez-en
   avec « + », prolongez par l'anneau du bout, double-cliquez pour retirer ; un point choisi
   prend une altitude (↑ ↓). En fin de tracé, l'escadrille orbite, sauf autre choix dans
   l'onglet Route de sa fiche (se poser, rentrer, couvrir un convoi). Maj + glisser mesure
   avec la règle. Une ligne tirée depuis n'importe quelle escadrille d'une big wing (ou depuis
   son aérodrome) devient la route de toute la formation.
6. **Formations.** Le bouton « Formations » (ou « Créer une big wing » dans la fiche d'une
   escadrille) ouvre une page à deux colonnes : à gauche les unités disponibles (filtre par
   base ou par état), à droite la formation — son nom, son chef ★ et ses membres, avec → ← pour
   ajouter et retirer, ↑ ↓ pour l'ordre de relève. Il n'y a pas de limite de taille.
   - **Big wing** (chasse) : une seule unité dans la liste et sur la carte, une fiche, les
     mêmes ordres pour toutes. Elle décolle ensemble, se rassemble au-dessus du chef (cela
     prend du temps, 15 min au plus), puis vole à la vitesse de la plus lente. Une escadrille
     à court d'essence ou de munitions la quitte et rentre ; si c'est le chef, le suivant
     reprend sa mission. Deux formations se fusionnent (« Prendre… », onglet Membres) : tout
     dans le même panier.
   - **Groupe de soutien** (escortes) : les groupes appareillent, rejoignent un convoi,
     chassent et rentrent ensemble ; en route libre, ils suivent le chef en ligne de file.
     L'autonomie est celle du plus court : quand il doit rentrer, tous rentrent.
   - **Rassemblement** (onglet d'une formation) : sur le chef, ou sur un point placé sur la
     carte, à une altitude, à une heure donnée ou au plus tôt, avec la route à suivre ensuite
     (tracée depuis le point). Chaque membre a son heure de départ, celle de l'ordre : en
     Arcade elles sont calculées pour que tous arrivent ensemble ; en Standard la fiche
     affiche l'heure d'arrivée de chacun ; en Réaliste seulement les distances, à vous de
     compter le délai d'alerte, la montée et le trajet. « Lancer le plan » donne les ordres à
     leur heure. Avec une heure fixée, la formation quitte le rendez-vous à cette heure (les
     premiers arrivés tournent en attendant) ; au plus tôt, dès que tous sont là. À l'heure
     du rendez-vous, s'il manque quelqu'un, la formation attend (un
     temps maximum), ralentit vers la cible ou part sans lui ; une big wing pose la question
     (Entrée : le choix du plan). Les retardataires suivent le plan en retard, à pleine
     vitesse, et reprennent leur place en la rattrapant.
7. **Pilotes.** La fatigue monte en vol et en combat, baisse au sol. L'état d'alerte règle le
   délai pour être en l'air après l'ordre de décoller : *Repos* 2 h (le personnel peut être
   n'importe où ; on le confirme, récupération rapide), *Disponible* 30 min, *Alerte* 5 min,
   *Cockpit* 2 min (fatigue). Monter d'un état prend la différence (du repos à l'alerte :
   1 h 55, la fiche montre le rappel en cours) ; descendre est immédiat. L'onglet
   **Effectifs** d'un aérodrome tient le plan de chaque jour de ses escadrilles (heures de
   00:00 à 24:00, avec une frise des 24 heures à venir). Pour un jour de mission, la case
   « Seulement les prochaines 24 h » ouvre un plan vierge en heures H depuis maintenant
   (H0 – H+6 repos, H+6 – H+9 alerte, H+9 – H+20 cockpit…) ; passé ce délai (24 h, réglable),
   le plan du jour reprend. Les heures se tapent librement (`5:30`, `5h30`, `0530`). En
   Réaliste, des pilotes sont tués et remplacés lentement.
8. **Départs programmés.** « Décollage programmé » (ou « Appareillage programmé » pour un
   convoi ou un groupe d'escorte, à un jour et une heure) donne l'ordre à l'heure dite : la
   route se trace depuis la base (en pointillé, elle attend) ou les étapes se préparent dans
   l'onglet Navigation. L'heure est celle de l'ordre : le délai de l'état d'alerte s'y ajoute,
   d'où un rappel la première fois qu'on programme. « Chaque jour » répète l'ordre (une
   patrouille côtière à l'aube, par exemple). « Rejoindre une formation » (ou « Rejoindre un
   groupe de soutien ») fait partir l'unité à son heure pour rejoindre une big wing en vol
   (heure calculée à la règle). Un ordre qui ne peut pas partir (plein en cours, carénage,
   ni route ni étapes) attend et lève une alerte.
9. **Logistique.** Les convois déchargent carburant et matériel dans les ports ; le dépôt de
   Chilmark fournit les munitions. Envoyez des trains (jusqu'à 100 t, chargement mélangé) ou
   fixez des stocks minimum : les trains partent seuls. Sans carburant, une escadrille ne
   refait pas le plein ; sans munitions, elle repart à moitié armée, ou pas du tout. Les
   usines transforment le matériel en avions.
10. **Installations.** Aérodromes, radars, ports et usines peuvent être bombardés. Un radar
   hors service ouvre un trou dans la couverture ; à partir d'Adlertag, une station radar
   mobile peut le boucher (onglet Installations, « Déployer »).
11. **Dollars (hiver 1941).** Avant le prêt-bail, la cargaison des convois se paie comptant :
   l'onglet Logistique règle la part achetée de chaque convoi, ou commande des Hudson et des
   Catalina en Amérique.

Chaque raid se termine par un rapport, rangé dans « Rapports », qui ne dit que ce que la RAF
sait : le premier plot (« 15+ à 8 500 ft »), la composition une fois le raid vu (« vu par
610 Sqn à 09:44 »), les bombes tombées — c'est ainsi que l'on connaît sa cible —, les
escadrilles envoyées et les pertes. Un raid que personne n'a vu et qui n'a rien bombardé
finit « jamais vu » : reparti, ou fausse alerte du radar, impossible de le dire. Les attaques
à la grenade des groupes d'escorte ont aussi leur rapport. Les « Fiches » donnent les
performances des avions et des navires. Les pages mettent le jeu en pause (réglable).

**Alertes.** Tout événement qui demande le joueur lève une alerte au-dessus de la carte et
ralentit le temps (réglable) : un raid ramène à ×10 ; en mer, toute alerte (convoi attaqué ou
bombardé, escorte au combat, convoi pisté, contact U-Boot près d'un convoi, convoi à portée
des escortes, escorte qui doit rentrer, traînards, navires arrêtés ou qui attendent) ramène
à ×1 : on décide, puis on accélère soi-même ; une base sans carburant ou sans munitions, une
installation hors service, un ordre retardé ou une patrouille surprise, à ×600, en ambre.
Chaque vitesse se règle à part (Réglages, onglet Temps et alertes). « Voir » montre le
lieu. Une même alerte ne se répète pas pendant quelques heures, et les alertes moins
urgentes attendent derrière la plus urgente. Pendant un raid ou une attaque de convoi, une
vitesse élevée (au-delà de ×60 pendant un raid, de ×600 pendant une attaque) demande
confirmation : Entrée pour accepter, Échap pour rester. Il n'y a pas d'avance jusqu'au
prochain événement : le joueur doit pouvoir être surpris.

Raccourcis : Espace pause · 1 à 6 vitesse · A Atlantique · L Grande-Bretagne · G Angleterre ·
R ou Maj + glisser règle (la croix de son encart l'efface) · Entrée ajouter l'étape mesurée ·
C couverture radar · Échap annuler, puis fermer la fiche · ↑ ↓ altitude · Suppr retirer le point choisi ·
S décoller · B pleine vitesse · O orbite · P rentrer · D désengager du raid en cours · question à l'écran : Entrée oui (au
rendez-vous : le choix du plan), Échap non (au rendez-vous : partir).

## Mode développeur

La case « Mode développeur » des Réglages, protégée par un mot de passe, affiche en magenta
ce que l'ennemi fait vraiment, pour contrôler les scénarios : chaque raid dès son rassemblement, avec sa composition, son
altitude, sa phase et un trait vers sa cible ; chaque U-Boot à sa vraie position, avec son
état (patrouille, piste ou rejoint un convoi, rentre au port), ses torpilles et sa plongée.
Un badge « DEV » s'affiche dans le bandeau et un onglet « Ennemis » liste les raids à venir
et l'état des U-Boote. Dans les rapports, une ligne à part donne la vérité (composition,
cible, fin réelle). Le mode ne fait que lire la simulation : la partie, les sauvegardes et
les reprises restent identiques. Décocher la case l'arrête.

Le mot de passe n'est écrit nulle part : `data/dev.json` ne garde que son empreinte SHA-256
(espaces autour et majuscules ne comptent pas). Pour le changer :
`node tools/dev-password.mjs "nouveau mot de passe"`, puis reconstruire `dist/index.html`.
C'est un verrou contre l'allumage par hasard, pas un secret : le code du jeu reste lisible.

## Ordres au cap et étapes

Avions, convois et groupes d'escorte peuvent recevoir une liste d'étapes : un cap jusqu'à une
fin. La fin se tape librement : une durée (`6`, `1 h 30`, `30 h`), une heure (`14:20`), un
carré de la grille de l'Angleterre (`J5`) ou une position (`56N 12O`, `50.5N 1.5E`). La règle
affiche le cap, la distance et le temps de trajet de l'unité choisie ; Entrée ajoute l'étape
mesurée. Une étape déjà posée se corrige avec ✎.

## Réglages

Les « Réglages » tiennent en onglets : **Partie** (préréglage et réglages ci-dessous),
**Temps et alertes**, **Carte**, **Sons**, **Développeur**. Trois préréglages, modifiables un
par un :

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

Options : pause pendant les pages et durée du plan d'exception des Effectifs (Partie) ;
ralenti à l'alerte avec une vitesse pour chaque alerte, confirmation des vitesses élevées
pendant une action ennemie, questions d'engagement et de poursuite (Temps et alertes) ; tiges
d'altitude, grille de carrés, zoom automatique et **zones de vue** (aucune, de l'unité
choisie, de toutes) : ce qu'un avion voit des autres avions et, pour une patrouille côtière,
d'un U-Boot en surface ; ce qu'un groupe d'escorte voit d'un U-Boot en surface (vigies,
radar) et en plongée (ASDIC), de jour et de nuit (Carte) ; sons et volume (Sons).

## Organisation du code

```
/
├── README.md
├── index.html, style.css      page et styles
├── src/
│   ├── main.js                démarrage et boucle de jeu
│   ├── core/                  temps, aléatoire à graine, traductions, chargement des données
│   ├── sim/                   simulation (aucun accès à la page) : convois et navires,
│   │                          escadrilles, formations et rassemblements, raids, détection,
│   │                          contact direct, guidage, attitude face à l'ennemi et
│   │                          questions, combat, départs programmés et effectifs, patrouilles,
│   │                          lutte anti-sous-marine, pilotes, installations, logistique,
│   │                          radars mobiles, événements datés, convois réguliers et dollars,
│   │                          rapports, objectifs
│   ├── render/                caméra, carte, symboles, animations, vue de profil
│   ├── ui/                    souris, clavier, panneaux et fiche d'unité, pages (rapports,
│   │                          fiches techniques, formations), alertes, questions, campagne,
│   │                          tutoriel,
│   │                          mode développeur, sons
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

Les 129 tests (Node 20 ou plus récent, sans dépendance) vérifient notamment la géométrie, la
terre et la mer, les routes, les étapes et leur édition, le pilote à l'entrée des chenaux,
les interceptions, le guidage du contrôleur et les ratés, les rapports, les installations,
les trains mélangés, les munitions, la fatigue et les pilotes, les patrouilles, les U-Boote
(repères, plongée, chasse, traînards, retour de patrouille), la sauvegarde et la reprise à
l'identique, les nouveaux scénarios, les achats en dollars, la campagne, les alertes, la
confirmation des vitesses, le mode développeur, le contact direct (raids et U-Boote), les
formations (rassemblement, vitesse de la plus lente, relève du chef, fusion, guidage d'une
big wing, groupe de soutien qui suit son chef et rentre ensemble), l'attitude face à
l'ennemi (questions d'engagement, de poursuite et de mi-Manche, refus, questions coupées,
attitude abaissée pendant une poursuite, « Désengager » d'une escadrille ou d'une big wing),
les états d'alerte et la programmation des effectifs, les décollages et appareillages
programmés (chaque jour, rejoindre une formation, ordre qui attend), les plans de
rassemblement (départs calculés, retardataire, attendre ou ralentir, groupe de soutien sur un
point ou sur son chef), le plan du jour des Effectifs et son exception en heures H, la mer au
M2.4 (routes autour de la terre, retour au port choisi par le chenal, durée et interruption de
la chasse, passes de grenades et leurs rapports, fin de tracé des navires, bulle de port,
chasse jamais à terre, veille d'un groupe qui attend, retour au port après une attaque), les
zones de vue, la vitesse de chaque alerte, des rapports qui ne disent que ce que la RAF sait,
et une quinzaine complète sans ordres.

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
