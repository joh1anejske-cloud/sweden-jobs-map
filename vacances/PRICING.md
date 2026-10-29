# Escapade — connexion des tarifs de réservation (octobre 2026)

La page https://joh1anejske-cloud.github.io/sweden-jobs-map/vacances/ fonctionne en mode explorateur géographique et propose désormais des liens externes de recherche aux dates de l'utilisateur.

## Etat réel (NE PAS confondre les trois niveaux)

1. **Carte ouverte** : hébergements OpenStreetMap non tarifés ; leur disponibilité et leurs prestations ne sont pas vérifiées. Explorable immédiatement.
2. **Tarifs hôteliers Nuitee / LiteAPI** : intégration `/api/offers.js` développée et testable, mais **inactive** tant qu'un serveur et des accès de production ne sont pas configurés.
3. **Prix de forfait vol + hôtel** : **pas encore disponible**. Le frontend et le backend signalent `flightIncluded:false` et `completePackage:false`. Ne jamais conclure qu'un hôtel à 900 €/pers est un forfait à 900 €/pers.

## Pour activer la recherche d'hôtels avec de vrais prix

1. Créer un compte chez [Nuitee / LiteAPI](https://dashboard.liteapi.travel/) et obtenir une clé **production**, après validation des conditions du fournisseur (la sandbox ne garantit pas les disponibilités réelles). Le compte ou l'activation production peut nécessiter des moyens de paiement ou un portefeuille crédité, selon les règles du fournisseur.
2. Déployer ce dépôt GitHub comme projet web sur [Vercel](https://vercel.com/). Le fichier racine `api/offers.js` est une fonction serverless Node.js ; les pages existantes restent statiques.
3. Configurer **uniquement dans les variables d'environnement Vercel** :
   - `LITEAPI_KEY` : la clé API **production** ;
   - `LITEAPI_PRODUCTION` : `true` ;
   - `ESCAPADE_ACCESS_PIN` : un mot de passe fort, unique, d'au moins 12 caractères, utilisé pour protéger le quota API ;
   - éventuellement `ESCAPADE_SITE_ORIGIN` : l'origine HTTPS exacte du domaine hébergeant le frontend s'il est personnalisé.
4. Sur GitHub Pages, renseigner uniquement l'URL publique de la fonction Vercel dans `vacances/pricing-config.js`, par exemple `https://<projet>.vercel.app/api/offers`. **Jamais les clés ni le PIN dans ce fichier.**
5. Dans la page web, entrer le code d'accès dans le champ privé et cliquer « Vérifier les offres hôtelières ».

Si le site est également servi par Vercel dans son intégralité, la page détecte automatiquement `/api/offers` sur le même domaine, même si la configuration est vide.

## Recherche et limitations

- Les requêtes sont déclenchées par l'utilisateur uniquement (pas de requête API payante planifiée).
- Mode monde : les tarifs sont demandés sur **quatre zones** représentatives. Ce n'est pas un balayage exhaustif des millions d'établissements.
- Mode pays : jusqu'à quatre centres connus. Ville : une zone localisée. Les zones peuvent être parcourues successivement sur la carte.
- L'API interroge un maximum de 20 hôtels par zone pour limiter le quota fournisseur, avec maximum 4 zones/requête.
- Les filtres *dates, occupation, étoiles renseignées, pension / all inclusive, montant hôtel par personne* sont appliqués au serveur (offres à revalider avant achat).
- Les frais signalés comme payables sur place sont ajoutés lorsqu'ils ont un montant en EUR. Les offres au montant non chiffré sont exclues des tarifs vérifiables.
- Le calcul utilise le **prix de vente public** indiqué par Nuitee lorsqu'il existe, conformément aux indications de leur documentation.
- **PISCINE, VUE MER, PLAGE, CAMPING, AIRBNB, AVIS, VOLS, TRANSPORTS et prix forfaitaires ne sont pas vérifiés par ce connecteur.**
- Le clic sur une offre ouvre le site officiel lorsqu'il est communiqué, ou une recherche Booking.com. **Ces sites ne sont pas garantis de proposer le même tarif Nuitee.** L'app ne permet pas encore de payer/réserver une offre Nuitee. Les étapes PREBOOK/BOOK sont à développer avec un compte fournisseur autorisé.
- Protection PIN avec comparaison en temps constant et aucune clé supplier exposée au frontend. Cette protection n'est pas un système complet de limitation de débit : pour une exploitation publique, ajouter une limitation stricte au niveau de l'hébergeur.

## Tests

Fichiers développés : `api/offers.js`, `vacances/offers.js`, `vacances/pricing-config.js` et modifications de l'UI / carte.

Les tests unitaires sur réponse fournisseur simulée couvrent le prix total par chambre, les frais payés sur place, la formule AI, la limite de budget et l'indicateur qui empêche d'assimiler l'hôtel seul au forfait avec vol. Ils ne prouvent pas qu'une connexion de production est active.

## Documentation éditeur

- https://docs.liteapi.travel/reference/post_hotels-rates
- https://docs.liteapi.travel/docs/hotel-rates-api-json-data-structure
- https://docs.liteapi.travel/docs/faq
