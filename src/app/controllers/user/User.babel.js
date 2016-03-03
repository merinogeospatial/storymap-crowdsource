import $ from 'jquery';
import AppStore from 'babel/store/AppStore';
import lang from 'dojo/_base/lang';
import URI from 'lib/urijs/src/URI';
import OAuthInfo from 'esri/arcgis/OAuthInfo';
import IdentityManager from 'esri/IdentityManager';
import UserActions from 'babel/actions/UserActions';
import ArcgisAppItem from 'babel/utils/arcgis/appItems/AppItem';
import Logger from 'babel/utils/logging/Logger';

const _logger = new Logger({source: 'User Controller'});

const _onError = function onError(error) {
  _logger.logMessage({
    type: 'error',
    error
  });
};

const _onStatus = function onStatus(message,debugOnly) {
  _logger.logMessage({
    type: 'status',
    debugOnly,
    message
  });
};

export default class UserController {
  constructor () {

    // Autobind methods
    this.updateAppState = this.updateAppState.bind(this);
    this.initialLoginAndLoad = this.initialLoginAndLoad.bind(this);
    this.checkLoginStatus = this.checkLoginStatus.bind(this);
    this.loginWithOAuth = this.loginWithOAuth.bind(this);
    this.finishOAuthLogin = this.finishOAuthLogin.bind(this);
    this.verifyCredentials = this.verifyCredentials.bind(this);
    window.signInAfterOauth = this.signInAfterOauth = this.signInAfterOauth.bind(this);

    // Subscribe to state changes
    this.updateAppState();
    this.unsubscribeAppStore = AppStore.subscribe(this.updateAppState);

    this.initialLoginAndLoad();

  }

  updateAppState() {
    this.appState = AppStore.getState();
    this.checkLoginStatus();

    if (lang.getObject('appState.app.loading.data',false,this) && !lang.getObject('appState.user.authenticated',false,this)) {
      this.verifyCredentials();
    }
  }

  initialLoginAndLoad() {
    const portal = lang.getObject('appState.app.portal',false,this);

    if (lang.getObject('appState.mode.isBuilder',false,this)) {
      portal.signIn().then((user) => {
        const token = lang.getObject('credential.token',false,user);

        if (lang.exists('appState.mode.isBuilder',this) && lang.exists('appState.config.appid',this) && this.appState.config.appid.length === 32) {
          ArcgisAppItem.getDataById({
            token
          });
        } else if (lang.exists('appState.mode.fromScratch',this)) {
          this.verifyCredentials();
        }
      },_onError);
    } else if (lang.exists('appState.config.appid',this) && this.appState.config.appid.length === 32) {
      IdentityManager.checkSignInStatus(portal.portalUrl).then((credential) => {
        const token = lang.getObject('token',false,credential);

        ArcgisAppItem.getDataById({
          token
        });
      },(err) => {
        ArcgisAppItem.getDataById();
        _onStatus('App load check sign in status - ' + err.message,true);
      });
    }
  }

  checkLoginStatus() {

    const portal = lang.getObject('appState.app.portal',false,this);
    const pendingLogin = lang.getObject('appState.user.pendingLogin',false,this);

    if (!this.checkLoginOnFirstContribute && lang.getObject('appState.app.contributing.active',false,this) && lang.getObject('appState.app.contributing.view',false,this) === 'login') {
      this.checkLoginOnFirstContribute = true;

      IdentityManager.checkSignInStatus(portal.portalUrl).then(() => {
        portal.signIn().then(() => {
          this.verifyCredentials();
        });
      });
    }

    if (!this.pendingLogin && pendingLogin && pendingLogin.method) {
      if (pendingLogin.method === 'oauth') {
        this.pendingLogin = pendingLogin;
        this.loginWithOAuth(this.pendingLogin.service);
      }
    }
  }

  loginWithOAuth(service) {
    const portal = lang.getObject('appState.app.portal',false,this);

    if (!IdentityManager.findCredential(portal.portalUrl)) {
      const clientId = lang.getObject('appState.items.app.data.settings.oauth.clientId',false,this);
      const redirectUri = lang.getObject('appState.items.app.data.settings.oauth.redirectUris',false,this)[0];
      const url = new URI(portal.url);
      const portalHost = portal.portalHostname;
      let socialOAuthUrl = false;

      if (portalHost === 'devext.arcgis.com') {
        socialOAuthUrl = 'https://devext.arcgis.com/sharing/rest/oauth2/social/authorize';
      } else if (portalHost === 'www.arcgis.com') {
        socialOAuthUrl = 'https://arcgis.com/sharing/rest/oauth2/social/authorize';
      }

      url.protocol('https');
      const info = new OAuthInfo({
        appId: clientId,
        portalUrl: url.href().stripTrailingSlash(),
        popup: true,
        showSocialLogins: true
      });

      IdentityManager.registerOAuthInfos([info]);

      if (socialOAuthUrl && service !== 'arcgis') {
        window.open(socialOAuthUrl + '?client_id='+clientId+'&response_type=token&expiration=20160&autoAccountCreateForSocial=true&socialLoginProviderName='+service+'&redirect_uri=' + window.encodeURIComponent(redirectUri), 'oauth-window', 'height=400,width=600,menubar=no,location=yes,resizable=yes,scrollbars=yes,status=yes');
      } else {
        IdentityManager.getCredential(portal.url,{
          oAuthPopupConfirmation: false
        });
      }
    } else {
      portal.signIn().then(() => {
        this.finishOAuthLogin();
      });
    }

  }

  verifyCredentials() {
    const portal = lang.getObject('appState.app.portal',false,this);
    const userPermissions = {
      publisher: false,
      editor: false,
      contributor: false
    };

    if (!lang.getObject('appState.mode.fromScratch',false,this) && lang.getObject('appState.mode.isBuilder',false,this) && portal.userIsAppEditor() && portal.userIsAppPublisher()) {
      userPermissions.publisher = true;
      userPermissions.editor = true;
      userPermissions.contributor = true;
    } else if (!lang.getObject('appState.mode.fromScratch',false,this) && lang.getObject('appState.mode.isBuilder',false,this) && portal.userIsAppEditor()) {
      userPermissions.editor = true;
      userPermissions.contributor = true;
    } else if (lang.getObject('appState.mode.isBuilder',false,this) && portal.userIsAppPublisher()) {
      userPermissions.publisher = true;
      userPermissions.contributor = true;
    } else if (portal.getPortalUser()) {
      userPermissions.contributor = true;
    }

    if (lang.getObject('appState.user.contributor',false,this) !== userPermissions.contributor || lang.getObject('appState.user.editor',false,this) !== userPermissions.editor || lang.getObject('appState.user.publisher',false,this) !== userPermissions.publisher) {
      UserActions.authenticateUser(userPermissions);
    }
  }

  signInAfterOauth(credential) {
    const portal = lang.getObject('appState.app.portal',false,this);

    if (credential) {
      var properties = $.extend({
        server: portal.url
      },credential);

      IdentityManager.registerToken(properties);
    }
    portal.signIn().then(() => {
      this.finishOAuthLogin();
    });
  }

  finishOAuthLogin() {
    this.verifyCredentials();
    this.pendingLogin = false;
    UserActions.loginOAuthFinish();
  }

}