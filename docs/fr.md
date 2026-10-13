# ista Web'conso (France)

Amène dans Gladys les relevés qu'**ista** fait à distance dans votre immeuble :
les **répartiteurs de frais de chauffage** de vos radiateurs et, quand le
portail les fournit, vos **compteurs d'eau**. Les données viennent du portail
résident ista [ista-webconso.fr](https://www.ista-webconso.fr) (« Mon espace
résident »).

> **Non affiliée à ista.** ista et Web'conso sont des marques de leurs
> propriétaires. Cette intégration est un projet indépendant.
>
> **Développée sans compte : retours bienvenus.** Personne ne l'a encore
> essayée sur un vrai compte Web'conso. C'est le type d'intégration le plus
> fragile : il n'y a pas d'API publique, elle lit donc le portail comme le fait
> votre navigateur, et peut cesser de fonctionner le jour où ista modifie son
> site.

## Ce que vous obtenez

Un appareil, **Logement ista**, avec :

| Fonctionnalité                           | Type Gladys | Unité  | Ce que c'est                                                                                           |
| ---------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Unités de chauffage du jour              | Compteur    | aucune | Les unités de tous vos radiateurs pour la journée, pondérées par le coefficient de chacun (facturées). |
| Radiateur _pièce_ — n° _série_ (chacun)  | Compteur    | aucune | L'index affiché sur le répartiteur de ce radiateur.                                                    |
| Eau froide / Eau chaude _pièce_ (chacun) | Volume      | m³     | L'index cumulé de ce compteur. **Non vérifié**, voir les limites.                                      |
| Eau froide — total / Eau chaude — total  | Volume      | m³     | La somme des index, quand le logement a plusieurs compteurs de ce fluide.                              |

Les unités de chauffage **n'ont pas d'unité physique** : un répartiteur ne
mesure pas d'énergie, il sert seulement à partager la facture de chauffage de
l'immeuble entre les logements. Elles sont donc affichées comme de simples
compteurs, sans kWh.

Chaque relevé est **daté de son propre jour**, même quand le portail le publie
avec plusieurs jours de retard : les graphiques de Gladys montrent la
consommation le jour où elle a eu lieu, pas le jour où elle a été lue. À la
création de l'appareil, les 7 derniers jours déjà lus lui sont envoyés.

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

Comme chaque lecture rattrape les 7 derniers jours, coller un cookie neuf une
fois par semaine suffit à garder l'historique complet.

## Fréquence de lecture du portail

Le portail est lu toutes les **12 heures** par défaut, réglable de **3 à 24
heures** (**Intervalle de relevé**). ista met à jour les relevés **une fois par
jour au plus**, et beaucoup d'immeubles ne sont relevés **qu'une fois par
semaine** : lire plus souvent n'apporte rien et ne fait que charger le
portail. Chaque lecture ne demande que les jours pas encore lus, une petite
requête par jour et par fluide, avec une pause entre deux.

## Limites

- **Connexion vérifiée en partie.** Le portail envoie le navigateur vers la
  page de connexion d'ista (`login.ista.com`). L'intégration suit les mêmes
  étapes, et cela a été vérifié sur le vrai portail jusqu'au refus d'un compte
  inventé (pas de captcha). Une connexion réussie avec un vrai compte n'a pas
  encore été vue.
- **Eau non vérifiée.** La page du chauffage est connue grâce à un projet
  public qui la lisait en 2025. Les pages de l'eau sont une supposition :
  quand le portail les refuse, aucune fonctionnalité d'eau n'apparaît, et le
  test de la connexion compte 0 compteur d'eau. Si votre eau n'apparaît pas, signalez-le.
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
