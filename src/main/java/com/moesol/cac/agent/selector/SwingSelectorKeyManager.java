package com.moesol.cac.agent.selector;

import java.awt.AWTKeyStroke;
import java.awt.KeyboardFocusManager;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.net.Socket;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.CertificateParsingException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.prefs.BackingStoreException;
import java.util.prefs.Preferences;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.X509KeyManager;
import javax.swing.AbstractAction;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.KeyStroke;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;

import com.moesol.url.CacHookingAgent;
import com.moesol.url.Config;

/**
 * When installed as the default key manager, this class prompts the user as
 * needed to choose a key.
 * 
 * @author hastings
 */
public abstract class SwingSelectorKeyManager implements X509KeyManager {
	private String choosenAlias = null;
	private final Object keyStoreLock = new Object();
	private KeyStore keyStore;

	public SwingSelectorKeyManager() {
	}

	/**
	 * Injects this manager into the SSLContext.
	 * 
	 * @throws NoSuchAlgorithmException
	 * @throws KeyManagementException
	 */
	public static void configureSwingKeyManagerAsDefault() throws NoSuchAlgorithmException, KeyManagementException {
		if (CacHookingAgent.DEBUG) {
			System.out.println("Context: " + CacHookingAgent.CONTEXT);
		}
		KeyManager[] kmgrs = makeKeyManagers();
		SSLContext sslContext = SSLContext.getInstance(CacHookingAgent.CONTEXT);
		sslContext.init(kmgrs, null, new java.security.SecureRandom());
		SSLContext.setDefault(sslContext);

		HttpsURLConnection.setDefaultSSLSocketFactory(sslContext.getSocketFactory());
	}

	private static KeyManager[] makeKeyManagers() {
		String os = System.getProperty("os.name").toLowerCase();
		if (os.startsWith("win")) {
			System.out.println("Windows key manager");
			return new KeyManager[] { new WindowsSelectorKeyManager() };
		} else {
			System.out.println("Linux key manager");
			return new KeyManager[] { new Pkcs11SelectorKeyManager() };
		}
	}

	private KeyStore getKeyStore() {
		synchronized (keyStoreLock) {
			if (keyStore != null) {
				return keyStore;
			}
			try {
				keyStore = accessKeyStore();
			} catch (Exception e) {
				reportAndConvert(e);
			}
			return keyStore;
		}
	}

	protected abstract KeyStore accessKeyStore() throws Exception;

	@Override
	public synchronized String chooseClientAlias(final String[] keyType, final Principal[] issuers, Socket socket) {
		if (CacHookingAgent.DEBUG) {
			System.out.println("chooseClientAlias: ");
		}
		if (choosenAlias != null) {
			if (CacHookingAgent.DEBUG) {
				System.out.println("cached chooseClientAlias: " + choosenAlias);
			}
			return choosenAlias;
		}

		Config config = Config.loadFromUserHome();
		choosenAlias = config.getDefaultCertificateName();
		if (choosenAlias != null) {
			choosenAlias = choosenAlias.trim();
			if (!choosenAlias.isEmpty()) {
				if (CacHookingAgent.DEBUG) {
					System.out.println("config chooseClientAlias: " + choosenAlias);
				}
				return choosenAlias;
			}
		}

		try {
			final String[] aliases = getClientAliases(null, issuers);
			SwingUtilities.invokeAndWait(new Runnable() {
				@Override
				public void run() {
					choosenAlias = pickOnSwingThread(aliases);
				}
			});
		} catch (Exception e) {
			throw reportAndConvert(e);
		}
		if (CacHookingAgent.DEBUG) {
			System.out.println("chooseClientAlias: " + choosenAlias);
		}
		return choosenAlias;
	}

	private String pickOnSwingThread(String[] aliases) {
		Preferences prefs = Preferences.userNodeForPackage(getClass());
		String choosenAlias = prefs.get("choosenAlias", "");

		final JOptionPane pane = new JOptionPane();
		JPanel panel = new JPanel();
		panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));

		JButton preChoosen = null;
		List<JButton> buttons = new ArrayList<JButton>();
		for (final CertDescription cd : makeCertList(aliases)) {
			JButton jb = new JButton(cd.asHtml());
			jb.setHorizontalAlignment(SwingConstants.LEFT);
			jb.addActionListener(new ActionListener() {
				@Override
				public void actionPerformed(ActionEvent e) {
					pane.setValue(cd);
				}
			});
			panel.add(jb);
			buttons.add(jb);

			if (cd.getAlias().equals(choosenAlias)) {
				preChoosen = jb;
			}
		}

		pane.setMessage(panel);
		String cancel = "Cancel";
		pane.setOptions(new Object[] { cancel });

		final JDialog dialog = pane.createDialog("Select Certificate");
		bindArrowKeys(dialog);
		panel.getInputMap(JComponent.WHEN_ANCESTOR_OF_FOCUSED_COMPONENT).put(KeyStroke.getKeyStroke("ENTER"), "selectKey");
		panel.getActionMap().put("selectKey", new AbstractAction() {
			@Override
			public void actionPerformed(ActionEvent e) {
				System.out.println("selectKey");
				if (dialog.getFocusOwner() instanceof JButton) {
					JButton jb = (JButton) dialog.getFocusOwner();
					jb.doClick();
				}
			}
		});
		if (preChoosen != null) {
			preChoosen.requestFocusInWindow();
		}
		
		dialog.setVisible(true);
		Object result = pane.getValue();

		if (result instanceof CertDescription) {
			CertDescription cd = (CertDescription) result;
			prefs.put("choosenAlias", cd.getAlias());
			try {
				prefs.flush();
			} catch (BackingStoreException e1) {
				e1.printStackTrace();
			}
			return cd.getAlias();
		}
		return null;
	}

	private void bindArrowKeys(JDialog dialog) {
		{
			Set<AWTKeyStroke> forwardKeys = dialog.getFocusTraversalKeys(KeyboardFocusManager.FORWARD_TRAVERSAL_KEYS);
			Set<AWTKeyStroke> newForwardKeys = new HashSet<>(forwardKeys);
			newForwardKeys.add(KeyStroke.getKeyStroke("DOWN"));
			newForwardKeys.add(KeyStroke.getKeyStroke("RIGHT"));
			dialog.setFocusTraversalKeys(KeyboardFocusManager.FORWARD_TRAVERSAL_KEYS, newForwardKeys);
		}

		{
			Set<AWTKeyStroke> backwardKeys = dialog.getFocusTraversalKeys(KeyboardFocusManager.BACKWARD_TRAVERSAL_KEYS);
			Set<AWTKeyStroke> newBackwardKeys = new HashSet<>(backwardKeys);
			newBackwardKeys.add(KeyStroke.getKeyStroke("UP"));
			newBackwardKeys.add(KeyStroke.getKeyStroke("LEFT"));
			dialog.setFocusTraversalKeys(KeyboardFocusManager.BACKWARD_TRAVERSAL_KEYS, newBackwardKeys);
		}
	}

	private CertDescription[] makeCertList(String[] aliases) {
		if (keyStore == null) {
			return new CertDescription[] { new CertDescription(null, "", "", "", ""), };
		}

		CertDescription[] result = new CertDescription[aliases.length];
		for (int i = 0; i < aliases.length; i++) {
			final String alias = aliases[i];
			Certificate cert;
			try {
				cert = keyStore.getCertificate(alias);
				X509Certificate x509 = (X509Certificate) cert;

				String purpose = X509PurposeDecoder.decode(x509);
				String principal = x509.getSubjectX500Principal().getName();
				Collection<List<?>> alt = x509.getSubjectAlternativeNames();
				String names = alt == null ? x509.getSubjectX500Principal().toString() : alt.toString();
				String issuer = x509.getIssuerX500Principal().getName();

				result[i] = new CertDescription(alias, principal, purpose, names, issuer);
			} catch (ClassCastException | KeyStoreException | CertificateParsingException e1) {
				result[i] = new CertDescription(alias, "", "", "", "");
			}
		}
		return result;
	}

	@Override
	public X509Certificate[] getCertificateChain(String alias) {
		try {
			return (X509Certificate[]) getKeyStore().getCertificateChain(alias);
		} catch (KeyStoreException e) {
			throw reportAndConvert(e);
		}
	}

	@Override
	public String[] getClientAliases(String keyType, Principal[] issuers) {
		if (CacHookingAgent.DEBUG) {
			System.out.println("getClientAliases: ");
		}
		try {
			KeyStore ks = getKeyStore();
			if (ks == null) {
				return new String[0];
			}
			ArrayList<String> asList = new ArrayList<String>();
			Enumeration<String> aliases = ks.aliases();
			while (aliases.hasMoreElements()) {
				// TODO filter by keyType/issuers?
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
			return (PrivateKey) getKeyStore().getKey(alias, null);
		} catch (Exception e) {
			throw reportAndConvert(e);
		}
	}

	@Override
	public String chooseServerAlias(String keyType, Principal[] issuers, Socket socket) {
		throw new UnsupportedOperationException("Client manager only");
	}

	@Override
	public String[] getServerAliases(String keyType, Principal[] issuers) {
		throw new UnsupportedOperationException("Client manager only");
	}

	protected RuntimeException reportAndConvert(final Exception e) {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				JOptionPane.showMessageDialog(null, e.getLocalizedMessage(), "Failed", JOptionPane.ERROR_MESSAGE);
			}
		});
		return new RuntimeException(e);
	}

}