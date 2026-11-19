# Prototype M2 — Acte I, 1940-1941

Prototype du jeu navigateur sur la Seconde Guerre mondiale : le joueur commande le soutien
allié (aviation, escortes, logistique), jamais les armées. Le M2 réunit l'Âge I en une
campagne de quatre scénarios, de la bataille de la Manche à l'hiver 1941 dans l'Atlantique,
avec un menu principal, un tutoriel en quatre leçons et une aide illustrée.

Le cahier des charges complet se trouve dans le projet claude.ai « Jeu navigateur seconde
guerre mondiale ».

**Version 2.10.2** (lot M2.10, interface, équilibre et tutoriel ; puis l'idée B de l'audit et
les retours des premières parties d'essai). Les décisions qui guident les lots M2.7 à M2.10
sont dans `claude/decisions-audit-m2.md` (fichier du projet) ; le journal des travaux est dans
`docs/journal-m2.7-m2.10.md`.

## Nouveautés de la 2.10.2 : retours des parties d'essai

- **États d'alerte et planning pour tout ce qui vole.** Les patrouilles de Coastal Command
  et les sections de guet se fatiguent en vol comme la chasse, mais seule la chasse avait
  ses états d'alerte : dans « Hiver dans l'Atlantique », une patrouille rentrait fatiguée
  d'une sortie et ne pouvait plus être mise au repos. Toute escadrille au sol a maintenant
  ses quatre états dans sa fiche (Repos, Disponible, Alerte, Cockpit), son planning dans la
  page **Effectifs** (qui revient dans l'Atlantique) et dans l'onglet Effectifs de son
  aérodrome ; un plan se copie d'une patrouille à l'autre. La page montre le type d'avion
  et la fatigue de chaque escadrille. Une longue patrouille coûte cher : 4 points par heure
  de vol, soit 37 pour une sortie de Whitley, 53 pour un Sunderland, 73 pour un Catalina ;
  une nuit de huit heures au Repos en rend 64, et depuis le Repos il faut deux heures pour
  décoller. **À savoir : la fatigue ne pèse que sur le combat ; une patrouille fatiguée voit
  aussi loin qu'une autre.** Rien n'a changé dans la simulation : les règles de fatigue et
  les mesures d'équilibre sont celles de la 2.10.
- **Onglets d'une installation qui abrite des unités.** Les onglets des unités superposées
  valent aussi pour un aérodrome ou un port : sa fiche porte son propre onglet, puis un par
  escadrille au sol ou par navire au port (les groupes d'un groupe de soutien n'en font
  qu'un). On clique l'aérodrome ou le port, puis l'onglet de l'unité voulue ; l'onglet de
  l'installation ramène à sa fiche, qui pour un port liste désormais les navires présents.
  Une escadrille qui décolle ou un groupe qui prend la mer quitte les onglets.
- **Campagne : les avions à abattre suivent la chasse reportée.** Comme l'objectif de
  chasse depuis le M2.7, le nombre d'avions à abattre d'une bataille jouée en campagne est
  ramené à la part des chasseurs présents au matin : avec 58 % de sa chasse, le 15 septembre
  demande 19 avions au lieu de 32. Le briefing, le journal et l'objectif disent les deux
  nombres. Hors campagne, rien ne change.
- L'**idée B** (ci-dessous) est du lot, et se coupe dans Réglages, onglet Carte et fiche :
  « Patrouilles en mer ».

## Nouveauté de la 2.10.1 : la zone de patrouille plutôt que l'avion (idée B)

À ×3 600, un avion de patrouille traverse 250 km de carte par seconde quand un convoi en
parcourt 17 : l'avion clignotait. **À partir de ×600, une patrouille de Coastal Command en vol
est dessinée par ce qu'elle fait** : son repère se tient près du convoi qu'elle couvre, au bout
de sa route ou là où elle orbite ; sa plaque dit « couvre HX 102 », « en route », « en
patrouille » ou « rentre » ; son cercle est tracé en bleu, hachuré là où elle voit (tout le
cercle de jour, la courte portée de son radar ASV la nuit, rien la nuit sans radar). Rien
d'autre ne change : la simulation fait voler l'avion comme avant, le
repère se clique et se glisse comme l'avion, l'unité en main retrouve son avion et sa route,
et à ×60 ou moins l'avion lui-même est dessiné. Une case des Réglages (Carte et fiche) rend
l'ancien affichage.

## Nouveautés du M2.10

- **Tutoriel en quatre leçons** de trois à cinq minutes (menu principal, Entraînement) :
  *intercepter* (un raid perdu en démonstration, l'instructeur faisant décoller trop tard,
  avec le bilan des heures ; puis un raid à gagner, une douzaine de bombardiers sans
  escorte), *ravitailler* (un train de carburant et un stock minimum), *escorter* (un
  rapport de quart, un groupe envoyé au-devant d'un convoi, les consignes) et *états d'alerte
  et fatigue*. Chaque leçon a son petit scénario et ses réglages ; elle se joue d'une traite
  et ne remplace pas la partie en cours. Pendant une démonstration, l'instructeur a la main :
  la boîte de la leçon dit « Regardez… » et aucun ordre ne part.
- **Équilibre**, mesuré au joueur automatique sur trente graines par conduite : ne rien faire
  perd toujours ; jouer simple en Standard gagne 23, 22 et 25 fois sur 30 (Kanalkampf,
  Adlertag, 15 septembre) ; jouer soigné en Réaliste gagne 20, 27 et 20 fois sur 30, donc pas
  forcément du premier coup. Kanalkampf demande aussi des avions abattus (30), une chasse
  gardée et des convois mieux livrés (80 % pour les HX, 70 % pour le convoi côtier) ; Adlertag
  compte les heures où ses aérodromes et ses radars sont hors service sur toute la semaine,
  et ses bases ont moins de carburant d'avance ; le 15 septembre demande 32 avions abattus.
  Les seuils se rejugent sans rejouer avec `tools/bot/thresholds.mjs`. Deux limites connues,
  dites au journal : en campagne, le 15 septembre est plus dur que seul ; dans l'Atlantique,
  jouer soigné en Réaliste ne gagne qu'une fois sur deux.
- **Fatigue** : l'Alerte 5 min fatigue un peu, Disponible 30 min repose peu, le Repos repose.
  Des escadrilles laissées toute la semaine à cinq minutes finissent fatiguées : la relève de
  nuit compte. En échange, voler fatigue moins qu'avant (4 points par heure de vol et 1 par
  décollage, au lieu de 7 et 2). Une escadrille fatiguée le dit sous son nom, dans sa fiche.
  Sans fatigue, le bouton Effectifs et le lien vers les plans disparaissent (depuis la
  2.10.2 toute escadrille a ses états d'alerte : ils restent donc dans l'Atlantique).
- **Alertes** : une alerte qui demande un ordre reste affichée (« À décider ») jusqu'à l'ordre
  ou jusqu'à ce qu'on la ferme (« Voir » montre l'endroit sans la fermer) ; une information
  s'efface seule. Au-delà de quatre alertes en attente, aucune n'est jetée : les plus
  anciennes passent au journal comme non lues, le bouton Journal en porte le nombre et ouvre
  le journal sur elles.
- **Barre du haut** sur une ligne à 1 024 px : pictogrammes avec une bulle (« Règle (R) ») et un
  mot dessous quand la place le permet, un seul bouton « Vue », le Journal (J), l'aide (?) et
  le menu ☰.
- **Aides des fiches** repliables (Réglages, Carte et fiche) : chaque section garde un « ? »
  qui rouvre la sienne ; les avertissements restent visibles.
- **Unités superposées** : un pion empilé porte le nombre d'unités ; un clic ouvre la pile en
  onglets sur le bord gauche de la fiche, et le glisser part de l'unité en main, jamais d'une
  autre. Depuis une pile fermée rien ne se trace, et la carte le dit. Un convoi avec son
  escorte garde son repère et sa plaque (navires, nœuds), avec le nom du groupe dessous.
  Un glisser lâché sur plusieurs cibles demande laquelle.

## Nouveautés du M2.9

- **Menu principal pleine page**, hors de la carte : Continuer (scénario, date de jeu et
  temps joué de la dernière partie), Campagne (la chaîne de l'Âge I et ce qui est gagné),
  Scénarios (une carte par bataille : dates, enjeu, durée estimée), Entraînement (mis en avant
  tant que le tutoriel n'a pas été joué jusqu'au bout), Charger, Réglages, Aide. Le
  préréglage se choisit là où l'on lance une partie.
- **Bouton ☰ en jeu** : Reprendre, Sauvegarder, Exporter, Réglages de la partie, Aide,
  Recommencer, Menu principal. Revenir au menu garde la partie. Recommencer demande
  confirmation dès dix minutes de jeu ; lancer ou charger une autre partie aussi, et la
  partie remplacée est gardée parmi les sauvegardes automatiques.
- **Écran de fin** : Rejouer, Scénario suivant quand la campagne a une suite, Menu principal.
- **Sauvegardes** : la partie en cours, une sauvegarde automatique par jour de jeu (toutes les
  deux heures de jeu dans une bataille d'une journée ; les cinq dernières de la partie en
  cours sont gardées, et la dernière de chacune des cinq parties d'avant), des sauvegardes
  manuelles, l'export et l'import d'un fichier. Une sauvegarde contient la partie, ses
  réglages et tout son journal, rapports de quart compris. Elle porte un numéro de format : une
  migration par version, une validation avant chargement (chaque partie de la sauvegarde est
  du bon genre, puis la sauvegarde est essayée dix minutes de jeu sur un monde à part) et un
  message clair pour un fichier abîmé ou trop récent : rien n'est demandé ni remplacé avant
  que le fichier soit vérifié. Les parties de la version 2.6.1 se chargent. Un enregistrement
  qui échoue (stockage plein, navigation privée) s'affiche dans la barre du haut et au menu
  principal ; une partie qui n'a pas pu être gardée le dit avant d'être remplacée, export à
  portée de main. Les leçons du tutoriel ne s'enregistrent pas.
- **Les réglages appartiennent à la partie** : copiés dans la partie à son lancement,
  enregistrés avec elle, changés en cours de route par un ordre que le journal note. Le
  préréglage peut changer en cours de partie : l'écran de fin et la campagne le disent
  (« commencée en Réaliste, terminée en Standard »).
- **Carte et outils par scénario** : chaque scénario déclare dans ses données sa zone, sa vue
  de départ, ses couches (grille RAF, radars, routes, eaux fermées, ombre de la nuit), ses
  outils et son rythme en mer. La chaîne de campagne, les vues et les étapes du tutoriel sont
  dans `data/campaign.json` et `data/tutorial.json`.
- **Sous le capot** : `main.js` découpé (le grand aiguillage des boutons devient une table
  d'actions) ; fabrique d'entités étendue aux escadrilles, aux groupes, aux U-Boote et aux
  raids ; états d'alerte renommés dans le code (`min30`, `min5`) avec migration des
  sauvegardes ; une seule source pour le numéro de version.

## Nouveautés du M2.8

Tout se passe dans « Hiver dans l'Atlantique » ; Kanalkampf, Adlertag et le 15 septembre ne
changent que par le jour et la nuit au soleil.

- **Le rythme des quarts.** La mer n'appelle plus le joueur événement par événement. À chaque
  relève (0, 4, 8, 12, 16 et 20 h) un rapport s'écrit, onglet « Signaux » du journal : convois,
  groupes d'escorte, air, renseignement, signaux du quart et décisions en attente, chacune
  avec le bouton qui y répond. Le jeu ne s'arrête que pour une décision nouvelle (réglable :
  aussi matin et soir, ou à chaque relève) et, entre deux relèves, pour la première attaque
  d'un convoi dans la nuit. Un arrêt est une pause : « Reprendre » repart à la vitesse d'avant.
- **Silence radio** (Standard et Réaliste, réglable). En haute mer, convois et groupes ne
  sont vus que par estimation : repère en tirets marqué « ? », cercle de doute qui grandit
  depuis le dernier point sûr. Un ordre part par radio à la relève suivante, au projecteur
  d'un avion en vue, ou confié à un groupe qui rejoint le convoi. Les eaux fermées, les
  approches des ports et la couverture des radars de Downhill et de Glenarm (nouveaux, avec
  Castlerock) restent suivies en direct.
- **Grenades.** 40 par navire, refaites au port ; grenadage plein ou économe ; à vide, des
  passes à blanc qui font encore plonger. La chasse s'arrête seule ; la durée de chasse
  réglable disparaît.
- **Rester ou Chasser, un vrai choix.** Une passe coule ou endommage moins souvent (environ
  une chasse sur deux aboutit), et un U-Boot qui se dérobe en profondeur n'est retrouvé
  qu'une fois sur trois : chasser coûte des grenades et laisse le convoi seul. Un groupe en
  « Rester » ne quitte plus son convoi pour un U-Boot qu'il ne peut pas atteindre : il le
  force à plonger. Le BdU remplace un U-Boot coulé trois semaines plus tard. Victoire sous
  7,5 % de pertes (8 % avant). Au joueur automatique, aucune conduite ne gagne à coup sûr.
- **Avions.** L'attaque d'une patrouille sur un U-Boot se voit, coulé ou non, une fois par
  sortie ; son repère peut lancer la chasse d'un groupe. Le 502 Sqn a son radar ASV.
- **Radar d'escorte** : daté et par groupe (EG 1 le 1er mars 1941, EG 3 le 15), à courte portée.
- **Achats en Amérique** : chaque offre d'avions dit son prix en dollars et en tonnes de
  cargaison, son délai et sa date d'arrivée ; prévision de tonnage face à l'objectif ; les
  convois partent chargés à plein tant que la réserve paie (plus de part achetée à régler).
- **Jour et nuit au soleil**, à la date, à l'heure et à la position de chaque unité (seize
  heures de nuit en janvier à 56° N, onze fin mars), et **ombre de la nuit** sur la carte
  (réglage d'affichage). Les U-Boote attaquent à leur heure dans la nuit, plus tous ensemble
  à heure fixe.
- **Sous le capot** : calcul de route sans à-coups (plus aucun pas de simulation de plus de
  20 ms dans l'Atlantique), grilles construites à la création du monde.

Mesures au joueur automatique (10 graines par conduite) : 42 à 59 arrêts par partie
d'Atlantique avec les réglages par défaut, contre 50 à 147 avant ; Rester et Chasser gagnent
9 fois sur 10 en Standard, 5 et 2 fois sur 10 en Réaliste (Chasser gagnait 10 fois sur 10).
Le détail est au journal, section « Porte du M2.8 ».

Vérifié au M2.10 sur dix graines neuves (11 à 20) : 44 à 66 arrêts par partie (moyenne 54, dix
parties sur cent au-delà de 60) ; sur les vingt graines, Rester et Chasser gagnent 17 fois sur
20 en Standard, 9 et 7 fois sur 20 en Réaliste, et le jeu soigné 19 et 10 fois sur 20. Le
détail est au journal, « L'Atlantique sur dix graines neuves ».

## Nouveautés du M2.7

- **La station radar mobile ne fige plus le jeu** : toutes les installations, station mobile
  comprise, sont créées de la même façon. Si une erreur arrive quand même, le jeu se met en
  pause, le dit, et propose d'exporter la partie ou de reprendre la dernière sauvegarde.
- **La campagne peut se gagner en Réaliste** : l'objectif « garder la chasse » se mesure sur les
  chasseurs présents au début du scénario (les renforts arrivés ensuite comptent avec eux), et
  le briefing dit avec combien d'avions on commence. Au joueur automatique, le 15 septembre
  est gagné 5 fois sur 10 en engageant en masse ; joué simplement, il reste perdu, car il faut
  abattre 40 avions avec 60 % de la chasse (les seuils se règlent au M2.10).
- **Les vues** (touches A, L et G) cadrent la carte dans la partie que la fiche laisse libre.
- **Plaques empilées** : quand des plaques se recouvrent, un tracé part de l'unité en main, et la
  règle ne change plus la sélection. Glisser depuis un aérodrome fait décoller l'escadrille en
  main si elle s'y trouve, même quand d'autres le survolent ; un simple clic choisit toujours
  ce qui est sous le pointeur.
- **Touches de vitesse** lues par leur position : elles marchent sur un clavier AZERTY et au
  pavé numérique (verrouillage numérique allumé ; éteint, le pavé garde ses flèches).
- **Bilan de fin** selon le scénario (plus de U-Boote coulés un 15 septembre), avec le temps de
  jeu réel, pauses comprises.
- **Atlantique** : plus de grille RAF ; le 502 Sqn vole sur Whitley, le 10 Sqn RAAF est basé à
  Oban, et le convoi du 10 janvier 1941 est le HX 102.
- **Sous le capot** : sept règles mortes supprimées, une seule vitesse en plongée pour la
  simulation et la fiche, plus aucun texte français dans le code, un joueur automatique et des
  tests à chaque envoi (voir Tests et Outils).

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

Le jeu s'ouvre sur le **menu principal**, une page à part : Continuer (la partie en cours),
Campagne, Scénarios, Entraînement (les quatre leçons du tutoriel), Charger, Réglages et Aide. En jeu, le
bouton ☰ du bandeau ouvre le menu de la partie (Reprendre, Sauvegarder, Exporter, Réglages de
la partie, Aide, Recommencer, Menu principal) ; le jeu est en pause tant qu'il est ouvert.
« Campagne » montre la chaîne de l'acte I : une victoire ouvre le scénario suivant, et la
case « Débloquer tous les scénarios » les ouvre tous d'un coup. Le préréglage (Arcade,
Standard, Réaliste) se choisit sur les pages Campagne et Scénarios.

| Scénario | Période | L'essentiel |
| --- | --- | --- |
| Kanalkampf | 10-24 juillet 1940 | deux convois HX, un convoi côtier dans la Manche, le rail, les premiers raids |
| Adlertag | 12-18 août 1940 | raids sur les radars et les aérodromes, chasses libres, station radar mobile, relève |
| 15 septembre | une journée | deux grandes vagues sur les docks de Londres, Big Wing de Duxford |
| Hiver dans l'Atlantique | 10 janvier - 31 mars 1941 | convois réguliers HX et SC, meutes de U-Boote, dollars, prêt-bail |
| Entraînement | juillet 1940 | les quatre leçons du **tutoriel**, puis un scénario d'essai : un convoi, quelques raids |

Entre les batailles aériennes, le réglage « Campagne » reporte une partie des pertes : en
Standard, la chasse commence la bataille suivante avec la moitié des avions perdus en moins
(au moins 75 %) ; en Réaliste, avec toutes les pertes (au moins 60 %). Les usines et les
convoyeurs comblent ensuite les vides. Le briefing du scénario dit avec combien d'avions la
chasse commence, et l'objectif « garder la chasse » se mesure sur ces avions-là.

La partie en cours est enregistrée toute seule dans le navigateur : « Continuer » la reprend
où on l'a laissée. « Charger » liste aussi les cinq dernières sauvegardes automatiques (une
par jour de jeu, toutes les deux heures de jeu dans une bataille d'une journée) et les
sauvegardes manuelles (☰, Sauvegarder), et importe un fichier `.json` exporté par ☰,
Exporter. En Réaliste, ces points de reprise permettent de rejouer une journée sans tout
refaire.

## Comment jouer

Trois cartes, par le bouton « Vue » de la barre du haut ou au clavier : Atlantique (touche
A), Grande-Bretagne (L) et Angleterre (G) ; chaque scénario ne propose que les siennes. Les
outils de la barre sont des pictogrammes, avec leur nom et leur touche en bulle (« Règle
(R) ») et un mot dessous quand la place le permet : Vue, Règle, Radar, Formations, Effectifs
(seulement quand les pilotes fatiguent), Rapports, Fiches, Journal (J, avec le compte des
alertes non lues), Aide (?) et le menu ☰. L'**aide** tient en onglets — Ce scénario, La
fiche, Air, Mer, Temps et alertes, Parties et réglages, Touches — avec quelques images prises
sur le banc d'essai (`data/help/images.json`).

Quand plusieurs unités sont au même endroit (deux groupes dans le même port), leur pion porte
le nombre d'unités : un clic ouvre la pile en onglets sur le bord gauche de la fiche ; l'unité
de l'onglet choisi est mise en avant sur la carte, les autres s'estompent, et les ordres vont
à elle seule. Un aérodrome ou un port qui abrite des unités a les mêmes onglets : le sien
d'abord, puis un par escadrille au sol ou par navire au port.

**La fiche d'une unité** s'ouvre quand on clique une unité ou une installation, sur la carte
ou dans le tableau d'état : à droite de la carte, ou à gauche, ou en bas (Réglages, onglet
Carte et fiche) ; on tire son bord pour l'élargir (ou la grandir en bas), et la taille est
gardée. En haut, la **barre de commandes**, toujours visible, donne les ordres en icônes :
Décoller, Orbiter, Rentrer, Rompre H05 ; Défense, Attaque, Poursuite ; l'altitude ↑ ↓ ; la
vitesse et le boost. Pour un navire : Appareiller, Au port, Rester, Chasser, Stop ; pour un
convoi : Appareiller, Amirauté, Zigzag. Un survol de la souris donne le détail de chaque
bouton. Dessous, des onglets courts : **Commandes**, dont les sections suivent l'état de
l'unité (au sol : décollage et état d'alerte ; route et étapes, avec le profil de montée ;
mission ; formation ; au port : sortie et appareillage ; convois ; chasse aux U-Boote ; retour
au port…) — un clic sur un titre replie ou rouvre la section, et elle reste comme on la
laisse —, **État** et **Fiche technique** ; une formation a aussi **Rassemblement** et
**Membres**, un aérodrome **Ordres** et **Effectifs**. Tant qu'elle est ouverte, tout
s'adresse à cette unité : la règle, Entrée pour ajouter l'étape mesurée, ↑ ↓ pour l'altitude,
B pour le boost. Un clic sur une autre unité change de fiche ; un clic sur la carte ne ferme
plus rien ; la croix (ou Échap) ferme la fiche et la sélection. Une unité choisie que la fiche
cacherait (ou hors de l'écran, choisie dans le tableau d'état) est ramenée en vue ; le bouton
⌖ centre la carte sur elle. L'aérodrome de l'escadrille choisie reste visible à toutes les
échelles : on trace la route d'un avion du Coastal Command depuis la carte de l'Atlantique.

**Vitesse.** Le curseur règle un avion de 50 à 100 % de sa vitesse de croisière ; le boost
(bouton ⚡ ou touche B) donne la pleine vitesse (127 % pour un Hurricane, 130 % pour un
Spitfire) et consomme beaucoup plus ; sous 100 %, il consomme un peu moins. Un convoi à
100 % garde ses navires groupés ; son boost (sa meilleure vitesse) laisse décrocher les plus
lents. Un groupe d'escorte va de 25 à 100 % de sa vitesse de mer ; son boost (+15 %) use son
autonomie 1,6 fois plus vite.

1. **Convois.** Tracez leur route, ou cliquez sur « Amirauté », jusqu'au chenal du
   nord de l'Irlande ou au canal Saint-Georges : un pilote les conduit au port. La vitesse
   ordonnée garde le convoi groupé ; plus près de sa vitesse maximale, des navires lents
   décrochent et deviennent des traînards. Le zigzag gêne les U-Boote mais ralentit.
   **Appareiller** : un groupe d'escorte met une heure à quitter son quai, puis sort en rade,
   juste au large de son port, ou suit jusqu'au bout le chenal choisi (« Sortie », section Au
   port) ; il y attend vos ordres, ou prend votre tracé ou vos étapes. Un tracé tiré depuis le
   port part de la rade et contourne la terre par la mer.
   **Le globe** : la carte est plate, mais les distances sont celles du globe (un kilomètre
   est-ouest de la carte vaut cos(latitude)/cos(50°) km réels) ; une route infléchie vers le
   nord, vers l'orthodromie, est donc plus courte qu'il n'y paraît, une route par le sud plus
   longue. Un convoi choisi montre en pointillé le plus court chemin sur le globe jusqu'aux
   entrées des chenaux, et la longueur de la route suivie.
2. **U-Boote.** Ils attaquent de nuit, en surface, chacun à son heure (de jour presque
   jamais, sauf contre un traînard). Le jour et la nuit suivent le soleil, à la date, à l'heure
   et à la position de chaque unité ; l'ombre de la nuit se voit sur la carte. Les zones hachurées viennent de la
   radiogoniométrie ; un repère U-Boot (vu par une vigie, un avion, l'ASDIC ou le radar)
   porte deux cercles : où il peut être en surface, et en plongée. La table garde un seul
   repère par U-Boot : un nouveau relèvement le déplace (au lieu d'empiler des cercles toutes
   les dix minutes d'une chasse), et un U-Boot coulé la quitte. Un groupe d'escorte
   « Rejoint » un convoi et, « Face aux U-Boote », « Reste » avec lui (il n'attaque que ce
   qui s'approche, 30 min et 15 km au plus) ou « Chasse » un contact frais : la chasse
   s'arrête seule (U-Boot coulé ou touché, contact perdu après 45 minutes de recherche, ou
   grenades tombées au tiers gardé pour le convoi) ; « Stop » ou tout autre ordre l'arrête, et un
   repère frais à moins de 80 km peut être chassé d'un clic. **Grenades** : 40 par navire
   (120 ou 160 par groupe), refaites au port avec le mazout ; grenadage plein (dix par passe)
   ou économe (cinq, moins de chances de couler) ; à vide, les passes sont à blanc : le
   U-Boot reste en plongée, sans rien risquer. Hors de l'Atlantique (alertes en direct), un U-Boot vu par un avion ou
   par une escorte lève l'alerte « U-Boot en vue » et ramène le jeu à ×1
   (une fois par heure et par U-Boot ; une attaque a sa propre alerte) ; dans l'Atlantique,
   la mer vit au rythme des quarts (voir plus bas). Un U-Boot tenu
   (ASDIC, ou vu tout près) reçoit une passe de grenades toutes les 10 minutes : coulé,
   touché (il rentre et n'est plus attaqué), perdu ou rien de visible ; chaque attaque a son rapport, avec les grenades lancées. « Au port »
   rentre au port choisi dans la section « Retour au port », du plus proche par mer au plus
   loin, avec distance et durée (tirées d'un champ de distances par mer calculé une fois par
   port : la fiche ne coûte plus rien, même à ×14 400) ; les routes de mer contournent la terre, et un tracé qui finit dans la bulle d'un
   port (15 km, montrée quand un navire est choisi) y entre. Comme pour les avions, la section
   « Route et étapes » dit que faire à la fin du tracé ou des étapes : s'arrêter et attendre, garder le cap, chercher
   un U-Boot sur place, rejoindre un convoi ou entrer au port. Un groupe qui attend ses ordres garde
   la veille ; un groupe attaqué en rentrant reprend ensuite sa route vers le port, sans
   s'arrêter auprès des convois qu'il croise. Un U-Boot tenu à l'ASDIC est annoncé avec sa
   profondeur et son cap estimés.
   **Autonomie** : un groupe rentre de lui-même quand il ne lui reste que de quoi gagner le
   port le plus proche, plus un jour. Retenu en mer jusqu'à la panne sèche, il quitte tout
   (convoi compris) et se traîne au port le plus proche à 7 nœuds ; il ne peut plus que
   changer de port, jusqu'à son ravitaillement.
   **Le commandement des U-Boote** (BdU, à Kernével) : tous les deux jours, une ligne de
   patrouille en travers de la route que les convois ont prise ces derniers temps, sur le
   méridien 17° O (d'abord la route de l'Amirauté, puis là où passent vos convois : une route
   par le sud est guettée à son tour) ; ses ordres par radio donnent parfois des relèvements.
   Le B-Dienst lit une part des messages de routage (réglage de 0 à 100 %) : deux U-Boote
   vont alors attendre le convoi en travers de sa route, en haute mer, à l'est de 30° O. Les Fw 200 Condor de
   Bordeaux-Mérignac couvrent le golfe de Gascogne et l'ouest de l'Irlande (cercle pointillé
   sur la carte) : ils signalent les convois aux U-Boote et bombardent parfois. Les U-Boote
   contournent la terre et n'entrent pas dans les eaux fermées en 1941 (mer d'Irlande et
   canal du Nord, Clyde, Hébrides intérieures et Minch, Manche, canal de Bristol) : ils
   attendent dans les approches.
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
   **Face à l'ennemi** (barre de commandes d'une escadrille ou d'une big wing) : en *Défense*,
   l'unité n'attaque pas d'elle-même (sauf un raid sur le convoi qu'elle couvre) et demande
   l'autorisation d'engager quand elle voit un raid ; en *Attaque* (le défaut, comme au M2.2),
   elle attaque les raids qui arrivent et demande avant de poursuivre un raid qui rentre ; en
   *Attaque et poursuite*, elle poursuit sans demander jusqu'à mi-Manche, puis demande
   l'autorisation d'aller au-delà. Une question s'affiche au-dessus de la carte, passe le jeu à ×1 et l'y
   laisse après la réponse ; sans réponse en 60 s de jeu, c'est non. Il n'y a qu'une question
   par raid et par escadrille (une seule pour une big wing), et on peut couper les questions
   dans « Réglages » (l'unité applique alors son attitude sans demander). Un tracé qui finit
   sur le raid, ou « Intercepter », vaut autorisation. **« Rompre H05 »** (barre de
   commandes, ou touche D) désengage l'unité — toute la big wing — du combat, de la poursuite ou du guidage :
   elle tourne sur place en attendant les ordres et laisse ce raid tranquille, quelle que soit
   son attitude, jusqu'à un nouvel ordre sur lui (un tracé qui finit dessus, « Intercepter »).
   Passer à une attitude plus prudente retire les autorisations déjà données : une escadrille
   qui poursuivait avec votre accord et que vous passez en Défense rompt au round suivant, sans
   reposer la question. Les groupes d'escorte gardent leur règle « Rester » ou « Chasser »,
   sans question.
5. **Tracés.** Cliquez une unité pour voir les carrés de sa route : glissez-les, ajoutez-en
   avec « + », prolongez par l'anneau du bout, double-cliquez pour retirer ; un point choisi
   prend une altitude (↑ ↓). En fin de tracé, l'escadrille orbite, sauf autre choix dans
   la section « Route et étapes » de sa fiche (se poser, rentrer, couvrir un convoi). Maj + glisser mesure
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
7. **Pilotes.** La fatigue monte en vol et en combat ; au sol elle baisse au Repos, baisse
   peu en Disponible, monte un peu en Alerte et davantage en Cockpit : une escadrille tenue
   toute la semaine à cinq minutes finit fatiguée. L'état d'alerte règle le
   délai pour être en l'air après l'ordre de décoller : *Repos* 2 h (le personnel peut être
   n'importe où ; on le confirme, récupération rapide), *Disponible* 30 min, *Alerte* 5 min,
   *Cockpit* 2 min (fatigue). Monter d'un état prend la différence (du repos à l'alerte :
   1 h 55, la fiche montre le rappel en cours) ; descendre est immédiat. Un état choisi à la
   main dans la fiche garde la main sur le planning jusqu'à **« Retour au planning »**. La
   page **Effectifs** (bouton du bandeau, ou « Programmation des effectifs… » dans la fiche
   d'une escadrille ou d'un aérodrome ; tous deux absents d'une partie sans fatigue) montre les aérodromes à gauche et, à droite, les
   escadrilles de celui qu'on choisit, chasse, guet et Coastal Command : leur type, leur
   état, leur fatigue, la frise des 24 heures à venir et le plan
   de chaque jour (heures de 00:00 à 24:00, il se répète), qu'on peut copier vers les autres
   escadrilles de l'aérodrome ou vers une autre. Pour un jour de mission, la case
   « Seulement les prochaines 24 h » ouvre un plan vierge en heures H depuis maintenant
   (H0 – H+6 repos, H+6 – H+9 alerte, H+9 – H+20 cockpit…) ; passé ce délai (24 h, réglable),
   le plan du jour reprend. Les heures se tapent librement (`5:30`, `5h30`, `0530`). En
   Réaliste, des pilotes sont tués et remplacés lentement.
8. **Départs programmés.** « Décollage programmé » (ou « Appareillage programmé » pour un
   convoi ou un groupe d'escorte, à un jour et une heure) donne l'ordre à l'heure dite : la
   route se trace depuis la base (en pointillé, elle attend) ou les étapes se préparent dans
   la section « Route et étapes ». L'heure est celle de l'ordre : le délai de l'état d'alerte s'y ajoute,
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
   ils partent chargés à plein tant que la réserve le permet, puis sur lest. L'onglet
   Logistique donne la prévision de tonnage face à l'objectif et les offres d'avions (Hudson,
   Catalina), chacune avec son prix en dollars et en tonnes de cargaison, son délai et sa date
   d'arrivée : chaque dollar dépensé là manquera aux cargaisons.
12. **Quarts (hiver 1941).** Dans l'Atlantique vous commandez depuis un QG à terre. À chaque
   relève (0, 4, 8, 12, 16 et 20 h) un rapport s'écrit, onglet « Signaux » du journal :
   convois, groupes d'escorte (mazout, grenades, consigne), air, renseignement, signaux du
   quart, et « À décider » avec le bouton qui répond. Le jeu s'arrête à une relève quand une
   décision nouvelle attend (réglage « Arrêt aux relèves » : aussi à 8 h et 20 h, ou à chaque
   relève) et, entre deux relèves, seulement pour la première attaque d'un convoi dans la
   nuit. Un arrêt est une pause : « Reprendre » repart à la vitesse d'avant.
13. **Silence radio (hiver 1941, Standard et Réaliste).** Hors des eaux suivies (eaux fermées
   aux U-Boote, approches des ports, couverture des radars de Downhill et de Glenarm), un
   convoi ou un groupe est dessiné à sa position estimée : contour en tirets, « ? » sur la
   plaque, cercle de doute qui grandit depuis le dernier point sûr. Un point sûr vient d'un
   avion en vue, d'une attaque, ou de « Demander la position » (qui donne un relèvement à
   l'ennemi). Un ordre part par radio à la relève suivante, au projecteur si un avion est en
   vue, ou confié à un groupe qui part rejoindre le convoi.

Chaque raid se termine par un rapport, rangé dans « Rapports », qui ne dit que ce que la RAF
sait : le premier plot (« 15+ à 8 500 ft »), la composition une fois le raid vu (« vu par
610 Sqn à 09:44 »), les bombes tombées — c'est ainsi que l'on connaît sa cible —, les
escadrilles envoyées et les pertes. Un raid que personne n'a vu et qui n'a rien bombardé
finit « jamais vu » : reparti, ou fausse alerte du radar, impossible de le dire. Les attaques
à la grenade des groupes d'escorte ont aussi leur rapport. Les « Fiches » donnent les
performances des avions et des navires. Les pages mettent le jeu en pause (réglable).

**Alertes.** Tout événement qui demande le joueur lève une alerte au-dessus de la carte et
ralentit le temps (réglable) : un raid ramène à ×10 ; en mer, toute alerte (convoi attaqué ou
bombardé, escorte au combat, convoi pisté, U-Boot en vue, convoi à portée
des escortes, escorte qui doit rentrer, traînards, navires arrêtés ou qui attendent) ramène
à ×1 : on décide, puis on accélère soi-même ; une base sans carburant ou sans munitions, une
installation hors service, un ordre retardé ou une patrouille surprise, à ×600, en ambre.
Chaque vitesse se règle à part (Réglages, onglet Temps et alertes). « Voir » montre le
lieu. Une même alerte ne se répète pas pendant quelques heures, et les alertes moins
urgentes attendent derrière la plus urgente. Pendant un raid ou une attaque de convoi, une
vitesse élevée (au-delà de ×60 pendant un raid, de ×600 pendant une attaque) demande
confirmation : Entrée pour accepter, Échap pour rester. Il n'y a pas d'avance jusqu'au
prochain événement : le joueur doit pouvoir être surpris.

Raccourcis : Espace pause · 1 à 6 vitesse (les six premières touches de la rangée des chiffres,
quel que soit le clavier, ou le pavé numérique) · A Atlantique · L Grande-Bretagne · G Angleterre ·
R ou Maj + glisser règle (la croix de son encart l'efface) · Entrée ajouter l'étape mesurée ·
C couverture radar · Échap annuler, puis fermer la fiche · ↑ ↓ altitude · Suppr retirer le point choisi ·
S décoller · B boost (avion ou navire) · O orbite · P rentrer · D rompre le combat (désengager le raid en cours) · question à l'écran : Entrée oui (au
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
**Temps et alertes**, **Carte et fiche**, **Sons**, **Développeur**. Au menu principal, ce
sont les réglages des prochaines parties. En jeu (☰, Réglages de la partie), l'onglet Partie
montre ceux de la partie en cours : ils sont enregistrés avec elle, chaque changement est un
ordre noté au journal, et le report de campagne, fixé au départ, ne se change plus. Trois
préréglages, modifiables un par un :

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
| B-Dienst : routes lues | jamais | 25 % | 50 % |
| Communications en mer | directes | silence radio | silence radio |

Le réglage **B-Dienst** (Partie) dit quelle part des messages de routage des convois la
marine allemande lit : 0 % en Arcade, 25 % en Standard, 50 % en Réaliste (0, 10, 25, 50, 75
ou 100 %). **Communications en mer** (Partie) : directes en Arcade, silence radio en Standard
et en Réaliste (il ne joue que dans l'Atlantique). **Arrêt aux relèves** (Temps et alertes) :
sur décision seulement, matin et soir aussi, ou à chaque relève. **Ombre de la nuit** et
**Aides des fiches** (affichées, ou repliées derrière un « ? » par section) : Carte et fiche.

Options : pause pendant les pages et durée du plan d'exception des Effectifs (Partie) ;
ralenti à l'alerte avec une vitesse pour chaque alerte, confirmation des vitesses élevées
pendant une action ennemie, questions d'engagement et de poursuite (Temps et alertes) ; tiges
d'altitude, grille de carrés (sauf dans l'Atlantique, qui n'en a pas), zoom automatique et **zones de vue** (aucune, de l'unité
choisie, de toutes) : ce qu'un avion voit des autres avions et, pour une patrouille côtière,
d'un U-Boot en surface ; ce qu'un groupe d'escorte voit d'un U-Boot en surface (vigies,
radar) et en plongée (ASDIC), de jour et de nuit ; la place de la fiche (à droite, à gauche
ou en bas de la carte) et l'affichage économe, un peu moins net mais plus fluide sur un grand
écran (Carte et fiche) ; sons et volume (Sons).

## Organisation du code

```
/
├── README.md
├── index.html, style.css      page et styles
├── src/
│   ├── main.js                démarrage : données, montage de la page, barre du haut
│   ├── core/                  temps, aléatoire à graine, traductions, chargement des données,
│   │                          numéro de version
│   ├── sim/                   simulation (aucun accès à la page) : convois et navires,
│   │                          escadrilles, formations et rassemblements, raids, détection,
│   │                          contact direct, guidage, attitude face à l'ennemi et
│   │                          questions, combat, départs programmés et effectifs, patrouilles,
│   │                          lutte anti-sous-marine, pilotes, installations, logistique,
│   │                          radars mobiles, événements datés, convois réguliers et dollars,
│   │                          rapports, objectifs, réglages de la partie, fabrique d'entités
│   ├── render/                caméra, carte, symboles, animations, vue de profil
│   ├── ui/                    souris, clavier, panneaux, fiche d'unité et sa barre de
│   │                          commandes, pages (rapports, fiches techniques, formations,
│   │                          effectifs), menu principal et vie d'une partie (menu.js,
│   │                          game.js), boucle de jeu (loop.js), table d'actions des
│   │                          panneaux (panelActions.js), alertes, questions, campagne,
│   │                          tutoriel, aide, mode développeur, sons
│   └── save/                  réglages du joueur ; parties : instantané, formats et
│                              migrations, validation, emplacements dans le navigateur
├── data/
│   ├── maps/                  côtes Natural Earth projetées, noms de lieux
│   ├── scenarios/             kanalkampf, adlertag, quinze-septembre, hiver-atlantique,
│   │                          m0-july-1940 (entraînement), lecon-* (les leçons, écrites
│   │                          comme une bataille avec des changements : « base »)
│   ├── campaign.json          chaîne de campagne, vues, cartes de scénario, couches et outils
│   ├── tutorial.json          les quatre leçons du tutoriel : scénario, réglages, étapes
│   ├── rules.json             équilibrage (avions, combat, détection, logistique, U-Boote)
│   ├── presets.json           préréglages Arcade, Standard, Réaliste
│   ├── help/images.json       images de l'aide, prises sur le banc d'essai
│   └── i18n/fr.json           tous les textes affichés
├── tests/                     tests de la simulation et des règles du code (Node)
├── tools/                     génération des cartes et de la version en un seul fichier
│   ├── bot/                   joueur automatique, mesures, ordres au hasard
│   └── smoke/                 test de fumée et images par seconde dans Chrome sans écran
├── docs/                      journal des travaux
├── .github/workflows/         tests à chaque envoi sur GitHub
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
npm test          # les 405 tests, environ quatre minutes
npm run lint      # ESLint (outils de développement : npm ci --prefix tools)
npm run fuzz      # 10 000 ordres au hasard par scénario, environ quatre minutes
npm run smoke     # le jeu dans Chrome sans écran : leçons, pages, fiches, corrections, quarts, menu, interface
npm run build     # reconstruit dist/index.html
```

GitHub lance le tout à chaque envoi (`.github/workflows/tests.yml`) et vérifie que
`dist/index.html` est bien celui que donnent les sources.

Le filet du M2.7 :

- **Ordres au hasard** (`tests/fuzz.test.js`, `tools/bot/monkey.mjs`) : tous les ordres de
  l'interface, donnés au hasard tout au long de chaque scénario, avec des sauvegardes et des
  reprises. Rien ne doit planter, aucune valeur ne doit devenir impossible, et la partie
  reprise doit être la partie sauvegardée.
- **Aller-retour de sauvegarde** (`tests/roundtrip.test.js`) par scénario, avec station
  mobile, formation, groupe de soutien, train, avion acheté et traînard ; même graine et mêmes
  ordres, même partie.
- **Sauvegardes de la version 2.6.1** (`tests/oldsaves.test.js`, `tests/fixtures/`) : trois
  vraies parties enregistrées par la 2.6.1 sont reprises et continuent.
- **Règles du code** (`tests/architecture.test.js`) : `src/sim` n'importe que `src/core`,
  aucun texte français dans le code, chaque clé de texte citée existe, aucune règle morte
  dans `data/rules.json`.
- **Test de fumée** (`tools/smoke/smoke.mjs`) : la version de développement et le fichier
  unique démarrent, les quatre leçons du tutoriel sont jouées à la souris et au clavier
  jusqu'à leur dernière étape, la barre du haut tient sur une ligne à 1 024 px, les alertes,
  les aides des fiches et les piles d'unités sont essayées, comme les états d'alerte d'une
  patrouille et les onglets d'un port et d'un aérodrome (2.10.2),
  chaque page et chaque sorte de fiche s'ouvre dans chaque scénario, et les corrections du
  M2.7 sont rejouées (plaques empilées, touches d'un clavier AZERTY, bilan de fin, briefing
  de campagne, garde-fou sur une erreur provoquée).
- Les tests de la 2.10.2 : repos et planning d'une patrouille (`tests/patrolrest.test.js`),
  onglets des installations (`tests/siteunits.test.js`), avions à abattre en campagne
  (`tests/campaign.test.js`).
- Les tests du M2.7 lui-même : campagne en Réaliste (`tests/campaign.test.js`), bilan de fin
  et chrono (`tests/summary.test.js`), touches (`tests/keys.test.js`), test de clic
  (`tests/hit.test.js`), station mobile sur un jour de jeu (`tests/sites.test.js`), champs
  des installations et des convois (`tests/entities.test.js`), cadrage des vues
  (`tests/camera.test.js`).

Les tests (Node 20 ou plus récent ; aucune dépendance pour `npm test`) vérifient notamment la géométrie, la
terre et la mer, les routes, les étapes et leur édition, le pilote à l'entrée des chenaux,
les interceptions, le guidage du contrôleur et les ratés, les rapports, les installations,
les trains mélangés, les munitions, la fatigue et les pilotes, les patrouilles, les U-Boote
(repères, plongée, chasse, traînards, retour de patrouille), la sauvegarde et la reprise à
l'identique, les nouveaux scénarios, les achats en dollars, la campagne, les alertes, la
confirmation des vitesses, le mode développeur, le contact direct (raids et U-Boote), les
formations (rassemblement, vitesse de la plus lente, relève du chef, fusion, guidage d'une
big wing, groupe de soutien qui suit son chef et rentre ensemble), l'attitude face à
l'ennemi (questions d'engagement, de poursuite et de mi-Manche, refus, questions coupées,
attitude abaissée pendant une poursuite, « Rompre » (désengager) une escadrille ou une big wing),
les états d'alerte et la programmation des effectifs, les décollages et appareillages
programmés (chaque jour, rejoindre une formation, ordre qui attend), les plans de
rassemblement (départs calculés, retardataire, attendre ou ralentir, groupe de soutien sur un
point ou sur son chef), le plan du jour des Effectifs et son exception en heures H, la mer au
M2.4 (routes autour de la terre, retour au port choisi par le chenal, durée et interruption de
la chasse, passes de grenades et leurs rapports, fin de tracé des navires, bulle de port,
chasse jamais à terre, veille d'un groupe qui attend, retour au port après une attaque), les
zones de vue, la vitesse de chaque alerte, des rapports qui ne disent que ce que la RAF sait,
au M2.5 la sortie en rade ou par un chenal, l'alerte « U-Boot en vue », la vitesse en % et le
boost des avions et des navires, l'état choisi à la main et « Retour au planning », la copie
d'un plan, l'aide et le tutoriel, au M2.5.1 un seul repère par U-Boot (aucun pour un U-Boot
coulé, et les sauvegardes plus anciennes nettoyées), au M2.6 la distance par mer jusqu'aux
ports (celle de la route qui sera prise, à peu de frais), les U-Boote qui contournent
l'Irlande et restent hors de la mer d'Irlande, le B-Dienst qui ne place jamais un U-Boot à
terre, le pisteur qui lâche un convoi entré dans le canal du Nord, une sauvegarde avec un
U-Boot à terre remis en mer, la fin des étapes d'un groupe, le retour au port avant la panne
sèche et la panne sèche elle-même, au M2.6.1 une nouvelle étape vérifiée depuis la fin de
l'étape en cours (et non depuis son début), et une quinzaine complète sans ordres.

## Outils

```
cd tools
npm install
node build-maps.mjs    # régénère data/maps/atlantic.json et channel.json
node build-page.mjs    # régénère dist/index.html
```

**Joueur automatique** (`tools/bot/`, voir son `README.md`). Il lit ce que la table montre et
donne les ordres d'un joueur ; il sert à mesurer l'équilibre avant et après chaque lot.

```
npm run bot -- adlertag simple standard 3      # une partie : scénario, conduite, préréglage, graine
npm run bot -- campagne masse-le-15 realistic 1
npm run measure -- --name essai --seeds 10     # toute la matrice, dix graines par ligne
node tools/bot/perf.mjs                        # durée des pas de simulation (machine au repos)
node tools/smoke/fps.mjs                       # images par seconde à ×14 400 dans Chrome
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
- Corrigé au M2.7 d'après l'audit : le 502 Sqn vole sur Whitley (depuis octobre 1940) ; le
  10 Sqn RAAF est à Oban, où l'unité avait un détachement ; la série HX commence à HX 102 le
  10 janvier 1941, si bien que le convoi du 1er mars est le HX 112.

## Limites connues du M2

- Pas de météo ; les réparations sont automatiques et les trains ne peuvent pas être
  bombardés.
- Combat, logistique et U-Boote restent abstraits ; l'équilibrage des nouveaux scénarios a
  été réglé avec des parties automatiques, il reste à l'éprouver en jouant.
- Dunkerque attend une étape suivante.
- Conçu pour un ordinateur : sur téléphone, un avertissement s'affiche et l'écran est serré.
