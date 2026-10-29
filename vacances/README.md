# Escapade — Carte mondiale des vacances

Page publique prévue : https://joh1anejske-cloud.github.io/sweden-jobs-map/vacances/

## Fonctionnement
- Interface entièrement distincte du site Suède original, publiée dans le sous-dossier `vacances/`.
- Carte Leaflet/OpenStreetMap navigable dans le monde entier, sans destination requise. Le menu « Monde entier » est sélectionné par défaut et un pays peut être choisi facultativement.
- 170 **repères de navigation** couvrant 95 pays, pour accéder aux zones du globe. Ces repères ne sont pas des annonces d’hébergement.
- Au clic sur « Explorer le monde », chargement d’un **échantillon** d’établissements OSM dans 16 zones réparties sur plusieurs continents, dans la limite du service Overpass. En choisissant un pays répertorié, échantillon dans jusqu’à 7 zones de ce pays. Cela ne constitue pas une recherche mondiale exhaustive.
- Tous les pays sélectionnables via menu sont pris en charge, mais un pays sans repère préchargé n’offre qu’une exploration locale autour de son centre/capitale, puis navigation manuelle sur la carte.
- Recherche de ville facultative par Open-Meteo/GeoNames ; aucun choix de ville n’est nécessaire pour le mode monde.
- Recherche de points d’intérêt d’hébergement (hôtels, campings, appartements, chalets, auberges…) dans un rayon choisi via Overpass.
- Marqueur -> fenêtre -> site web officiel (si renseigné), sinon fiche OpenStreetMap.
- Recherche complémentaire sur Booking.com ou Airbnb par lieu et dates (les liens de recherche ne garantissent pas que l’établissement précis soit référencé).
- Les filtres de dates, budget, vol, formule, bord de mer, vue mer et piscine sont des **préférences de voyage** enregistrées localement, pas des filtres vérifiés par l’API OpenStreetMap.
- Le type d’établissement et les étoiles **renseignées** dans OpenStreetMap sont filtrés dans la carte. Les établissements sans étoiles renseignées sont conservés.
- Les recherches locales sont mises en cache 1 h ; les échantillons monde/pays 24 h sur l’appareil. Les zones locales peuvent être rafraîchies à la demande. La synchronisation automatique d’une zone locale n’a lieu que lorsque la page reste ouverte.

## Limites importantes
OpenStreetMap ne fournit pas les tarifs de réservation, les disponibilités pour une période, les formules de restauration, les vols ou les évaluations clients. Les logements OSM de type « apartment » ne sont pas les annonces de particuliers d'Airbnb. Le résultat peut être partiel ou temporairement vide si l’API publique est saturée. La carte n’est **pas** actuellement un comparateur de prix ni un moteur de réservation.

Pour activer une recherche réelle « au plus 1 100 € par personne, tout compris avec vol, du 10 au 17 août 2027 », il faut des flux officiels d’inventaire et de tarifs : hébergement (ex. Booking.com Demand API avec accès partenaire), locations, campings et offres vol + hôtel (fournisseurs à contractualiser). Garder les clés secrètes côté serveur, jamais dans cette page statique. Les filtres tarifaires pourront alors éliminer les offres non conformes, sans masquer des valeurs inconnues comme si elles avaient été vérifiées.

## Sources
- https://wiki.openstreetmap.org/wiki/Overpass_API
- https://open-meteo.com/en/docs/geocoding-api
- https://developers.booking.com/demand/docs/getting-started/prerequisites

## Publication
Le workflow GitHub Pages existant déploie tout le dépôt, donc aussi ce sous-dossier, sans modifier les pages Suède. Pour tester : ouvrir la page (la carte du monde apparaît avec les repères orange), cliquer « Explorer le monde » pour un échantillon OSM, sélectionner la France pour explorer plusieurs zones ou cliquer sur un repère pour charger des adresses précises. Il n’y a plus de destination obligatoire.
