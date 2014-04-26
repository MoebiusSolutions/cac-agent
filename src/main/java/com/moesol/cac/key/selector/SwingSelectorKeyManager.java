package com.moesol.url;

import java.net.Socket;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Enumeration;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.X509KeyManager;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;

public class SwingSelectorKeyManager implements X509KeyManager {
	private final Object windowsMyLock = new Object();
	private KeyStore windowsMY;
	private String choosenAlias = null;
	
	public SwingSelectorKeyManager() {
	}

	public static void configureSwingKeyManagerAsDefault() throws NoSuchAlgorithmException, KeyManagementException {
		if (MscapiHookingAgent.DEBUG) { System.out.println("Context: " + MscapiHookingAgent.CONTEXT); }
		KeyManager[] kmgrs = makeKeyManagers();
		SSLContext sslContext = SSLContext.getInstance(MscapiHookingAgent.CONTEXT);
		sslContext.init(kmgrs, null, new java.security.SecureRandom());
		SSLContext.setDefault(sslContext);

		HttpsURLConnection.setDefaultSSLSocketFactory(sslContext.getSocketFactory());
	}
	private static KeyManager[] makeKeyManagers() {
		return new KeyManager[] { new SwingSelectorKeyManager() };
	}

	@Override
	public synchronized String chooseClientAlias(String[] keyType, Principal[] issuers, Socket socket) {
		if (MscapiHookingAgent.DEBUG) { System.out.println("chooseClientAlias: "); }
		if (choosenAlias != null) {
			if (MscapiHookingAgent.DEBUG) { System.out.println("cached chooseClientAlias: " + choosenAlias); }
			return choosenAlias;
		}
		
		Config config = Config.loadFromUserHome();
		choosenAlias = config.getDefaultCertificateName();
		if (choosenAlias != null) {
			choosenAlias = choosenAlias.trim();
			if (!choosenAlias.isEmpty()) {
				if (MscapiHookingAgent.DEBUG) { System.out.println("config chooseClientAlias: " + choosenAlias); }
				return choosenAlias;
			}
		}
		
		try {
			SwingUtilities.invokeAndWait(new Runnable() {
				@Override
				public void run() {
					choosenAlias = pickOnSwingThread();
				}
			});
		} catch (Exception e) {
			throw reportAndConvert(e);
		}
		if (MscapiHookingAgent.DEBUG) { System.out.println("chooseClientAlias: " + choosenAlias); }
		return choosenAlias;
	}

	private String pickOnSwingThread() {
		Object[] possibilities = getClientAliases(null, null);
		String s = (String)JOptionPane.showInputDialog(null,
		                    "Choose certificate:",
		                    "Customized Dialog",
		                    JOptionPane.PLAIN_MESSAGE,
		                    null,
		                    possibilities,
		                    possibilities[0]);
		//If a string was returned, say so.
		if ((s != null) && (s.length() > 0)) {
			return s;
		}
		return null;
	}
	
	@Override
	public X509Certificate[] getCertificateChain(String alias) {
		try {
			return (X509Certificate[]) getWindowsMyKeyStore().getCertificateChain(alias);
		} catch (KeyStoreException e) {
			throw reportAndConvert(e);
		}
	}

	@Override
	public String[] getClientAliases(String keyType, Principal[] issuers) {
		if (MscapiHookingAgent.DEBUG) { System.out.println("getClientAliases: "); }
		try {
			ArrayList<String> asList = new ArrayList<String>();
			Enumeration<String> aliases = getWindowsMyKeyStore().aliases();
			while (aliases.hasMoreElements()) {
				asList.add(aliases.nextElement());
			}
			return asList.toArray(new String[asList.size()]);
		} catch (KeyStoreException e) {
			throw reportAndConvert(e);
		}
	}

	@Override
	public PrivateKey getPrivateKey(String alias) {
		try {
			return (PrivateKey) getWindowsMyKeyStore().getKey(alias, null);
		} catch (Exception e) {
			throw reportAndConvert(e);
		}
	}

	private RuntimeException reportAndConvert(final Exception e) {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				JOptionPane.showMessageDialog(null, e.getLocalizedMessage(), "Failed", JOptionPane.ERROR_MESSAGE);
			}
		});
		return new RuntimeException(e);
	}
	
	@Override
	public String chooseServerAlias(String keyType, Principal[] issuers, Socket socket) {
		throw new UnsupportedOperationException("Client manager only");
	}
	
	@Override
	public String[] getServerAliases(String keyType, Principal[] issuers) {
		throw new UnsupportedOperationException("Client manager only");
	}
	
	public static void main(String[] args) {
		MscapiHookingAgent.DEBUG = true;
		System.out.println("chose: " + new SwingSelectorKeyManager().chooseClientAlias(null, null, null));
	}

	private KeyStore getWindowsMyKeyStore() {
		try {
			synchronized (windowsMyLock) {
				if (windowsMY != null) { return windowsMY; }
			    windowsMY = KeyStore.getInstance("Windows-MY");
			    windowsMY.load(null, null);
			    return windowsMY;
			}
		} catch (Exception e) {
			throw reportAndConvert(e);
		}
	}
	
}