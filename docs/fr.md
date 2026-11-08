# ista Web'conso (France)

Amène dans Gladys les relevés qu'**ista** fait à distance dans votre immeuble :
vos **compteurs d'eau** et, quand le portail les propose, les **répartiteurs de
frais de chauffage** de vos radiateurs. Les données viennent du portail
résident ista [ista-webconso.fr](https://www.ista-webconso.fr) (« Mon espace
résident »).

> **Non affiliée à ista.** ista et Web'conso sont des marques de leurs
> propriétaires. Cette intégration est un projet indépendant.
>
> **Eau vérifiée sur un vrai compte, chauffage pas encore.** Les relevés d'eau
> suivent des pages partagées par un résident en novembre 2026 ; ceux du
> chauffage n'ont pas encore été vus fonctionner. C'est le type d'intégration
> le plus fragile : il n'y a pas d'API publique, elle lit donc le portail comme
> le fait votre navigateur, et peut cesser de fonctionner le jour où ista
> modifie son site.

## Ce que vous obtenez

Un appareil, **Logement ista**, avec :

| Fonctionnalité                                         | Type Gladys | Unité  | Ce que c'est                                                                                     |
| ------------------------------------------------------ | ----------- | ------ | ------------------------------------------------------------------------------------------------ |
| Unités de chauffage du jour                            | Compteur    | aucune | Les unités de tous vos radiateurs sur le dernier jour relevé. **Non vérifié**, voir les limites. |
| Radiateur _pièce_ — n° _série_ (chacun)                | Compteur    | aucune | L'index affiché sur le répartiteur de ce radiateur. **Non vérifié**, voir les limites.           |
| Eau froide / Eau chaude _pièce_ — n° _numéro_ (chacun) | Volume      | m³     | L'index cumulé de ce compteur, tel que le portail le relève (réel ou estimé).                    |
| Eau froide — total / Eau chaude — total                | Volume      | m³     | La somme des index, quand le logement a plusieurs compteurs de ce fluide.                        |

Les unités de chauffage **n'ont pas d'unité physique** : un répartiteur ne
mesure pas d'énergie, il sert seulement à partager la facture de chauffage de
l'immeuble entre les logements. Elles sont donc affichées comme de simples
compteurs, sans kWh.

Chaque relevé est **daté de sa date de relevé**, qui a souvent quelques jours :
les graphiques de Gladys montrent l'index le jour où il a été relevé, pas le
jour où il a été lu. À la création de l'appareil, les relevés récents déjà lus
lui sont envoyés.

Un **widget de tableau de bord**, « Consommation ista », montre les unités de
chauffage du dernier jour, les index d'eau, un histogramme des unités de
chauffage par jour et la date du dernier relevé.

## Configuration

1. Installez l'intégration, ouvrez son onglet **Configuration**.
2. Laissez **Méthode de connexion** sur **E-mail et mot de passe**, et
   saisissez l'e-mail et le mot de passe de votre espace résident.
3. Choisissez la **langue des noms de fonctionnalités** (Gladys ne transmet
   pas votre langue à une intégration ; les noms sont figés à la création de
   l'appareil).
4. Enregistrez, puis cliquez sur **Tester la connexion et relever
   maintenant**. Le message sous le bouton indique combien de répartiteurs et
   de compteurs ont été trouvés, et la date du dernier relevé.
5. Ouvrez l'onglet **Découverte** et ajoutez l'appareil **Logement ista**.

### Quand l'e-mail et le mot de passe ne marchent pas : le cookie de session

Si l'état indique que le portail demande un captcha ou un second facteur, ou
que la page de connexion n'est pas reconnue, vous pouvez confier à
l'intégration la session de votre propre navigateur. C'est une solution de
repli : la session **expire** (quand vous vous déconnectez, ou après un temps
d'inactivité), et il faut alors en coller une nouvelle.

1. Sur un ordinateur, connectez-vous à
   [ista-webconso.fr](https://www.ista-webconso.fr) et ouvrez la page de
   consommation de votre logement.
2. Ouvrez les outils de développement (**F12**), onglet **Réseau**, et
   rechargez la page.
3. Cliquez sur une requête vers `ista-webconso.fr`. Dans **En-têtes de la
   requête**, copiez toute la valeur de la ligne **Cookie**. (Ou, dans
   **Application** / **Stockage** → **Cookies**, copiez la valeur de
   `JSESSIONID`.)
4. Ne cliquez **pas** ensuite sur « Se déconnecter » dans le portail : cela
   fermerait la session. Fermez simplement l'onglet.
5. Dans Gladys : **Méthode de connexion** → **Cookie de session**, collez le
   texte dans **Cookie de session**, enregistrez, et cliquez sur **Tester la
   connexion et relever maintenant**.

Les index sont cumulés : après un cookie expiré, le relevé suivant rattrape
la consommation ; seuls les jours intermédiaires n'ont pas de point dans les
graphiques.

## Fréquence de lecture du portail

Le portail est lu toutes les **12 heures** par défaut, réglable de **3 à 24
heures** (**Intervalle de relevé**). ista met à jour les relevés **une fois par
jour au plus**, souvent avec quelques jours de retard : lire plus souvent
n'apporte rien et ne fait que charger le portail. Chaque lecture ouvre la page
**index à la demande** du portail et, quand elle propose une date de relevé
plus récente, demande les index de cette date : deux petites requêtes (trois
avec le chauffage), une seule quand rien n'est nouveau.

## Limites

- **Connexion vérifiée.** Le portail envoie le navigateur vers la page de
  connexion d'ista (`login.ista.com`) ; l'intégration suit les mêmes étapes.
  Un résident s'est connecté avec en novembre 2026, par mot de passe et par
  cookie.
- **Chauffage non vérifié.** Les relevés de chauffage passent par l'onglet
  chauffage de la même page, connu seulement par le script du portail :
  personne ne l'a encore vu répondre. Si le chauffage est indiqué pour votre
  logement mais n'apparaît pas, les journaux le disent : merci de le signaler.
- **Index estimés.** Le portail marque certains index comme estimés (un
  compteur qui n'a pas répondu au relevé radio) : ils sont publiés tels que le
  portail les montre, et le relevé réel suivant prend le relais.
- **Un logement par compte.** Un compte qui a plusieurs logements montre leurs
  compteurs dans un seul appareil.
- **Remise à zéro des index.** Les répartiteurs repartent en général de zéro au
  relevé annuel : le graphique de l'index chute alors, pas celui des unités du
  jour.
- **Les noms sont figés** à la création de l'appareil (une règle de Gladys) :
  renommer dans le portail ne renomme pas les fonctionnalités.

## Dépannage

L'écran **Configuration** affiche l'état de la connexion :

| Message                                         | Que faire                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Le portail a refusé l'e-mail ou le mot de passe | Vérifiez-les en vous connectant à ista-webconso.fr.                                              |
| Captcha / second facteur                        | Utilisez le mode cookie de session (ci-dessus).                                                  |
| Connectez-vous une fois dans un navigateur      | Le portail demande quelque chose (nouveau mot de passe, CGU) : faites-le, puis testez à nouveau. |
| Page de connexion non reconnue                  | Le portail a changé : utilisez le mode cookie de session, et signalez-le.                        |
| Le cookie de session a expiré                   | Collez-en un nouveau.                                                                            |
| Format inconnu                                  | Le portail a changé : signalez-le avec les journaux.                                             |
| Le portail ista est injoignable                 | Nouvel essai dans l'heure, rien à faire.                                                         |

Pour signaler un problème, ouvrez un ticket sur
[GitHub](https://github.com/guim31/gladys-ista/issues) avec les journaux de
l'intégration (Gladys → intégration → **Journaux**). Les journaux ne
contiennent jamais votre e-mail, votre mot de passe ni votre cookie ; quand le
portail répond dans un format inconnu, ils en montrent la **structure** (noms
des champs, sans les valeurs), c'est ce qu'il faut pour adapter l'intégration.

## Confidentialité

Votre e-mail, votre mot de passe ou votre cookie restent dans la configuration
de Gladys. L'intégration garde la session du portail et les relevés récents
dans son propre volume (`/data`), et ne parle qu'au portail et à la page de
connexion d'ista.
