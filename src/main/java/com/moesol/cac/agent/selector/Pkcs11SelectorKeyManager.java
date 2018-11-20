package com.moesol.cac.agent.selector;

import java.io.File;
import java.io.IOException;
import java.security.KeyStore;
import java.security.KeyStore.CallbackHandlerProtection;
import java.security.Provider;
import java.security.Security;

import javax.security.auth.callback.Callback;
import javax.security.auth.callback.CallbackHandler;
import javax.security.auth.callback.PasswordCallback;
import javax.security.auth.callback.UnsupportedCallbackException;
import javax.swing.JOptionPane;

import com.moesol.cac.agent.Config;

public class Pkcs11SelectorKeyManager extends AbstractSelectorKeyManager {

	private Provider provider;

	@Override
	protected KeyStore accessKeyStore() throws Exception {
		setUpProvider();
		
		chooser.showBusy("Accessing CAC...");
		try {
			KeyStore ks = KeyStore.Builder
					.newInstance("PKCS11", provider, makeCallbackHandler())
					.getKeyStore();
			ks.load(null, null);
			return ks;
		} finally {
			chooser.hideBusy();
		}
	}
	
	private CallbackHandlerProtection makeCallbackHandler() {
		CallbackHandler handler = new CallbackHandler() {
			@Override
			public void handle(Callback[] callbacks) throws IOException,
					UnsupportedCallbackException {
				for (Callback c : callbacks) {
					if (c instanceof PasswordCallback) {
						PasswordCallback pc = (PasswordCallback) c;
						pc.setPassword(chooser.promptForPin(pc.getPrompt()));
					}
				}
			}
		};
		return new KeyStore.CallbackHandlerProtection(handler);		
	}
	
	@SuppressWarnings("restriction")
	private void setUpProvider() {
		chooser.showBusy("Initializing PKCS#11...");
		try {
			File configFile = new File(Config.computeProfileFolder(), "pkcs11.cfg");
			String configName = configFile.getAbsolutePath();
			if (configFile.exists()) {
				provider = Security.getProvider("SunPKCS11");
				provider = provider.configure(configName);
				Security.addProvider(provider);	
			} else {
				String message = "Not found: " + configName;
				String title = "PKCS#11 Configuration Not Loaded";
				JOptionPane.showMessageDialog(null, message, title, JOptionPane.WARNING_MESSAGE);
			}
		} finally {
			chooser.hideBusy();
		}
	}

	public static void main(String[] args) {
//		CacHookingAgent.DEBUG = true;
		Pkcs11SelectorKeyManager selector = new Pkcs11SelectorKeyManager();
		
		if (Boolean.getBoolean("tty")) {
			selector.setIdentityKeyChooser(new TtyIdentityKeyChooser(selector));
		}
		
		System.out.println("chose: "
				+ selector.chooseClientAlias(null, null, null));
		// Must not need to call System.exit(0) to shutdown or interferes with jgit.
	}

}
