package com.moesol.cac.agent.selector;

import java.awt.AWTKeyStroke;
import java.awt.KeyboardFocusManager;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.lang.reflect.InvocationTargetException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.prefs.BackingStoreException;
import java.util.prefs.Preferences;

import javax.swing.AbstractAction;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.KeyStroke;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import javax.swing.Timer;

public class SwingIdentityKeyChooser implements IdentityKeyChooser {
	private final IdentityKeyListProvider provider;
	private IdentityKeyCertFormatter formatter;
	private String choosenAlias;
	private Timer maybeShowBusy = new Timer(1000, e -> showBusyNow());
	private JDialog busy;
	
	public SwingIdentityKeyChooser(IdentityKeyListProvider provider) {
		this.provider = provider;
		this.formatter = DefaultCertFormatter.INSTANCE;
	}
	
	public void setCertFormatter(IdentityKeyCertFormatter formatter) {
		this.formatter = formatter;
	}

	public void showNoIdentitiesFound() {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				JOptionPane.showMessageDialog(null, "No identities found", "Failed", JOptionPane.WARNING_MESSAGE);
			}
		});
	}

	public String chooseFromAliases(final String[] aliases) throws InvocationTargetException, InterruptedException {
		SwingUtilities.invokeAndWait(new Runnable() {
			@Override
			public void run() {
				choosenAlias = pickOnSwingThread(aliases);
			}
		});
		return choosenAlias;
	}
	
	public void reportException(final Exception e) {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				JOptionPane.showMessageDialog(null, e.getLocalizedMessage(), "Failed", JOptionPane.ERROR_MESSAGE);
			}
		});
	}
	
	public void showBusy(final String message) {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				JOptionPane pane = new JOptionPane(message, JOptionPane.INFORMATION_MESSAGE);
				busy = pane.createDialog("CAC");
				busy.setModal(false);
			}
		});
		
		maybeShowBusy.setInitialDelay(3000);
		maybeShowBusy.setRepeats(false);
		maybeShowBusy.start();
	}
	
	public void showBusyNow() {
		busy.setVisible(true);
	}

	public void hideBusy() {
		maybeShowBusy.stop();
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				busy.setVisible(false);
				busy.dispose();
				busy = null;
			}
		});
	}

	public char[] promptForPin(String title, String prompt) {
		JLabel label = new JLabel(prompt);
		final JPasswordField pass = new JPasswordField(10);

		JPanel panel = new JPanel();
		panel.add(label);
		panel.add(pass);
		
		final JOptionPane pane = new JOptionPane();
		pane.setMessage(panel);
		pane.setMessageType(JOptionPane.QUESTION_MESSAGE);
		pane.setOptionType(JOptionPane.OK_CANCEL_OPTION);
		JDialog dialog = pane.createDialog(busy, title);
		dialog.addWindowFocusListener(new WindowAdapter() {
		    public void windowGainedFocus(WindowEvent e) {
		    	pass.requestFocusInWindow();
		    }
		});
		pass.addActionListener(new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent e) {
				pane.setValue(0);
			}
		});
		dialog.setVisible(true);
		Object result = pane.getValue();
		dialog.dispose();
		
		if (new Integer(0).equals(result)) {
			return pass.getPassword();
		}
		return null;
	}

	@SuppressWarnings("serial")
	private String pickOnSwingThread(String[] aliases) {
		Preferences prefs = Preferences.userNodeForPackage(getClass());
		String choosenAlias = prefs.get("choosenAlias", "");

		final JOptionPane pane = new JOptionPane();
		JPanel panel = new JPanel();
		panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));

		JButton preChoosen = null;
		List<JButton> buttons = new ArrayList<JButton>();
		X509Certificate[] certs = provider.makeCertList(aliases);
		for (int i = 0; i < aliases.length; i++) {
			final String alias = aliases[i];
			final X509Certificate cert = certs[i];
			String html = formatter.asHtml(alias, cert);
			JButton jb = new JButton(html);
			jb.setHorizontalAlignment(SwingConstants.LEFT);
			jb.addActionListener(new ActionListener() {
				@Override
				public void actionPerformed(ActionEvent e) {
					pane.setValue(alias);
				}
			});
			panel.add(jb);
			buttons.add(jb);

			if (choosenAlias.equals(alias)) {
				preChoosen = jb;
			}
		}

		pane.setMessage(panel);
		String cancel = "Cancel";
		pane.setOptions(new Object[] { cancel });

		final JDialog dialog = pane.createDialog("Select Identity");
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
		dialog.dispose();

		if (result instanceof String && result != cancel) {
			prefs.put("choosenAlias", (String) result);
			try {
				prefs.flush();
			} catch (BackingStoreException e1) {
				e1.printStackTrace();
			}
			return (String) result;
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

	@Override
	public void promptForCardInsertion(String title, String error) {
		String msg = error + "\n\nInsert Smartcard";
//		JOptionPane.showMessageDialog(null, msg);
		
	    Object stringArray[] = { "OK", "Exit" };
	    int r = JOptionPane.showOptionDialog(null, msg, title, 
	    		JOptionPane.YES_NO_OPTION, 
	    		JOptionPane.QUESTION_MESSAGE, null, stringArray, stringArray[0]);
	    switch (r) {
	    case JOptionPane.OK_OPTION:
	    	break;
	    case JOptionPane.NO_OPTION:
	    	System.exit(0);
	    	break;
    	default:
	    	break;	
	    }
	}

}
